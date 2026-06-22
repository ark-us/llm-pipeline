'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import * as d3 from 'd3'
import { parsePipelineJson5 } from '@/lib/pipeline-json5'
import { copyText } from '@/lib/clipboard'
import {
  classifyPipelineSource,
  evaluatePipelineExpression,
  evaluatePromptCall,
  inferPipelineValue,
  LispValue,
  pipelineValueToJson,
  printPipelineValue,
} from '@/lib/pipeline-lisp'
import DiagramSurface from './DiagramSurface'
import JsonGraphDiagram, { DiagramMetadata } from './JsonGraphDiagram'
import MarkdownLiveEditor from './MarkdownLiveEditor'
import CsvSpreadsheet from './CsvSpreadsheet'
import FormulaEditor, { FormulaEditorHandle } from './FormulaEditor'

type GraphNode = {
  id: string
  title: string
  x: number
  y: number
  width: number
  height: number
  markdown: string
  formula: string
  jsonView?: 'source' | 'diagram'
  jsonLayout?: DiagramMetadata
}

type GraphEdge = {
  id: string
  source: string
  target: string
  portal?: boolean
  portalPathIndex?: number
}

type ParentDiagram = {
  id: string
  name: string
  nodes: GraphNode[]
  selectedId: string | null
  transform: { x: number; y: number; k: number }
  childPosition: { x: number; y: number; width: number; height: number }
}

type StoredGraphState = {
  version: 4
  diagramName: string
  parents: ParentDiagram[]
  activeParentIndex: number | null
  nodes: GraphNode[]
  selectedId: string | null
  transform: {
    x: number
    y: number
    k: number
  }
}

const COMPACT_ZOOM = 0.48
const TITLE_HEIGHT = 42
const COMPACT_HEIGHT = 66
const GRAPH_STORAGE_KEY = 'llm-pipeline.graph.v1'
const STARTING_NODES: GraphNode[] = [
  {
    id: 'source',
    title: 'SourcePrompt',
    x: 80,
    y: 90,
    width: 390,
    height: 270,
    markdown: '# Source prompt\n\nDescribe the task, constraints, and expected output here.',
    formula: '',
  },
  {
    id: 'reason',
    title: 'ReasoningStep',
    x: 590,
    y: 190,
    width: 390,
    height: 270,
    markdown: '## Transform\n\n- Read `SourcePrompt`\n- Extract requirements\n- Produce a structured answer',
    formula: '',
  },
  {
    id: 'result',
    title: 'FinalResult',
    x: 1100,
    y: 90,
    width: 390,
    height: 270,
    markdown: '',
    formula: '(str ReasoningStep " and \\n" SourcePrompt)',
  },
]

const NAME_PARTS = [
  'Amber', 'Bright', 'Clever', 'Cloud', 'Copper', 'Delta', 'Echo', 'Flux',
  'Green', 'Lunar', 'Nova', 'Quiet', 'Rapid', 'Silver', 'Solar', 'Swift',
]

function isStoredNode(value: unknown): value is GraphNode {
  if (!value || typeof value !== 'object') return false
  const node = value as Record<string, unknown>
  return typeof node.id === 'string'
    && typeof node.title === 'string'
    && typeof node.x === 'number'
    && typeof node.y === 'number'
    && typeof node.width === 'number'
    && typeof node.height === 'number'
    && typeof node.markdown === 'string'
    && typeof node.formula === 'string'
}

function unwrapStoredValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(unwrapStoredValue)
  if (!value || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  if (record.kind === 'object' && record.entries && typeof record.entries === 'object') {
    return unwrapStoredValue(record.entries)
  }
  if (record.kind === 'sequence' && Array.isArray(record.items)) {
    return record.items.map(unwrapStoredValue)
  }
  return Object.fromEntries(
    Object.entries(record).map(([key, entry]) => [key, unwrapStoredValue(entry)]),
  )
}

function normalizeDiagramMetadata(value: unknown, fallbackName: string): DiagramMetadata | undefined {
  if (!value || typeof value !== 'object') return undefined
  const source = value as Record<string, unknown>
  const viewport = source.viewport && typeof source.viewport === 'object'
    ? source.viewport as Record<string, unknown>
    : {}
  const positions = source.positions && typeof source.positions === 'object'
    ? source.positions as DiagramMetadata['positions']
    : {}
  const childrenSource = source.children && typeof source.children === 'object'
    ? source.children as Record<string, unknown>
    : {}
  const children = Object.fromEntries(
    Object.entries(childrenSource).flatMap(([name, child]) => {
      const normalized = normalizeDiagramMetadata(child, name)
      return normalized ? [[name, normalized]] : []
    }),
  )
  return {
    name: typeof source.name === 'string' ? source.name : fallbackName,
    viewport: {
      x: typeof viewport.x === 'number' ? viewport.x : 0,
      y: typeof viewport.y === 'number' ? viewport.y : 0,
      k: typeof viewport.k === 'number'
        ? viewport.k
        : typeof viewport.zoom === 'number'
          ? viewport.zoom
          : 1,
    },
    positions,
    children,
  }
}

function migrateStoredNode(node: GraphNode): GraphNode {
  const storedLayout = normalizeDiagramMetadata(node.jsonLayout, node.title)
  if (editorMode(node.markdown) === 'markdown') return { ...node, jsonLayout: storedLayout }
  try {
    const parsed = parsePipelineJson5(node.markdown) as Record<string, unknown>
    const embeddedLayout = parsed.$diagram
    const functional = { ...parsed }
    delete functional.$diagram
    const jsonLayout = storedLayout
      ?? (embeddedLayout && typeof embeddedLayout === 'object'
        ? normalizeDiagramMetadata(embeddedLayout, node.title)
        : undefined)
    return {
      ...node,
      markdown: JSON.stringify(unwrapStoredValue(functional), null, 2),
      jsonLayout,
    }
  } catch {
    return node
  }
}

function isStoredGraphState(value: unknown): value is StoredGraphState {
  if (!value || typeof value !== 'object') return false
  const state = value as Record<string, unknown>
  if (state.version !== 4
    || typeof state.diagramName !== 'string'
    || !Array.isArray(state.nodes)
    || !state.nodes.every(isStoredNode)) {
    return false
  }
  if (state.selectedId !== null && typeof state.selectedId !== 'string') return false
  if (!state.transform || typeof state.transform !== 'object') return false
  const transform = state.transform as Record<string, unknown>
  return typeof transform.x === 'number'
    && typeof transform.y === 'number'
    && typeof transform.k === 'number'
    && Number.isFinite(transform.x)
    && Number.isFinite(transform.y)
    && Number.isFinite(transform.k)
    && transform.k >= 0.18
    && transform.k <= 2.5
}

function isVersionThreeGraphState(value: unknown) {
  if (!value || typeof value !== 'object') return false
  const state = value as Record<string, unknown>
  return state.version === 3
    && typeof state.diagramName === 'string'
    && Array.isArray(state.nodes)
    && state.nodes.every(isStoredNode)
}

function isVersionTwoGraphState(value: unknown) {
  if (!value || typeof value !== 'object') return false
  const state = value as Record<string, unknown>
  return state.version === 2
    && Array.isArray(state.nodes)
    && state.nodes.every(isStoredNode)
    && (state.selectedId === null || typeof state.selectedId === 'string')
    && typeof state.transform === 'object'
    && state.transform !== null
}

function safeTitle(value: string) {
  const cleaned = value.replace(/\s+/g, '').replace(/[^A-Za-z0-9_-]/g, '')
  if (!cleaned) return ''
  return /^[A-Za-z_]/.test(cleaned) ? cleaned : `Node${cleaned}`
}

function replaceFormulaSymbol(formula: string, oldTitle: string, newTitle: string) {
  return formula.replace(
    /"(?:\\.|[^\\"])*"|;[^\n]*|[^\s()[\]{}",;]+/g,
    (token) => {
      if (token.startsWith('"') || token.startsWith(';')) return token
      if (token === oldTitle) return newTitle
      if (token.startsWith(`${oldTitle}.`)) return `${newTitle}${token.slice(oldTitle.length)}`
      return token
    },
  )
}

function formulaSymbols(formula: string) {
  return (formula.match(/"(?:\\.|[^\\"])*"|;[^\n]*|[^\s()[\]{}",;]+/g) ?? [])
    .filter((token) => !token.startsWith('"') && !token.startsWith(';'))
}

function parentDependencyEdges(
  graphNodes: GraphNode[],
  diagramTitle: string,
  parent: ParentDiagram | undefined,
  portalPathIndex: number,
): GraphEdge[] {
  if (!parent) return []
  const byTitle = new Map(graphNodes.map((node) => [node.title, node]))
  const edges = new Map<string, GraphEdge>()
  parent.nodes.forEach((dependent) => {
    formulaSymbols(dependent.formula).forEach((symbol) => {
      if (!symbol.startsWith(`${diagramTitle}.`)) return
      const sourceTitle = symbol.slice(diagramTitle.length + 1).split('.')[0]
      const source = byTitle.get(sourceTitle)
      if (!source) return
      const id = `${source.id}->parent-${parent.id}`
      edges.set(id, {
        id,
        source: source.id,
        target: '',
        portal: true,
        portalPathIndex,
      })
    })
  })
  return [...edges.values()]
}

function randomTitle(nodes: GraphNode[]) {
  const used = new Set(nodes.map((node) => node.title))
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const left = NAME_PARTS[Math.floor(Math.random() * NAME_PARTS.length)]
    const right = NAME_PARTS[Math.floor(Math.random() * NAME_PARTS.length)]
    const candidate = `${left}${right}`
    if (!used.has(candidate)) return candidate
  }
  return `Node${Date.now().toString(36)}`
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const r = Math.min(radius, width / 2, height / 2)
  context.beginPath()
  context.moveTo(x + r, y)
  context.arcTo(x + width, y, x + width, y + height, r)
  context.arcTo(x + width, y + height, x, y + height, r)
  context.arcTo(x, y + height, x, y, r)
  context.arcTo(x, y, x + width, y, r)
  context.closePath()
}

function isNodeCompact(node: GraphNode, scale: number) {
  return scale < COMPACT_ZOOM || node.width * scale < 190 || node.height * scale < 125
}

function displayedHeight(node: GraphNode, scale: number) {
  return isNodeCompact(node, scale) ? COMPACT_HEIGHT : node.height
}

function editorMode(value: string): 'markdown' | 'json' | 'json5' {
  const type = classifyPipelineSource(value)
  if (type !== 'object' && type !== 'array') return 'markdown'
  const trimmed = value.trim()
  try {
    JSON.parse(trimmed)
    return 'json'
  } catch {
    try {
      parsePipelineJson5(trimmed)
      return 'json5'
    } catch {
      return 'markdown'
    }
  }
}

function nodeExpression(node: GraphNode) {
  if (node.formula.trim()) return node.formula.trim()
  return classifyPipelineSource(node.markdown) === 'lisp' ? node.markdown.trim() : ''
}

function evaluateGraphNodes(graphNodes: GraphNode[]) {
  const byTitle = new Map(graphNodes.map((node) => [node.title, node]))
  const values = new Map<string, LispValue>()
  const errors = new Map<string, string>()
  const dependencyTitles = new Map<string, Set<string>>()
  const evaluating = new Set<string>()

  const evaluateNode = (node: GraphNode): LispValue => {
    if (values.has(node.id)) return values.get(node.id) ?? null
    if (evaluating.has(node.id)) throw new Error(`circular dependency at '${node.title}'`)
    evaluating.add(node.id)

    try {
      const expression = nodeExpression(node)
      if (!expression) {
        const value = inferPipelineValue(node.markdown)
        values.set(node.id, value)
        dependencyTitles.set(node.id, new Set())
        return value
      }
      const promptCall = evaluatePromptCall(expression, (name) => {
        const dependency = byTitle.get(name)
        if (!dependency) throw new Error(`'${name}' not found`)
        return evaluateNode(dependency)
      })
      if (promptCall) {
        const value = inferPipelineValue(node.markdown)
        values.set(node.id, value)
        dependencyTitles.set(node.id, promptCall.dependencies)
        return value
      }
      const result = evaluatePipelineExpression(expression, (name) => {
        const dependency = byTitle.get(name)
        if (!dependency) throw new Error(`'${name}' not found`)
        return evaluateNode(dependency)
      })
      values.set(node.id, result.value)
      dependencyTitles.set(node.id, result.dependencies)
      return result.value
    } catch (error) {
      errors.set(node.id, error instanceof Error ? error.message : String(error))
      values.set(node.id, null)
      return null
    } finally {
      evaluating.delete(node.id)
    }
  }

  graphNodes.forEach(evaluateNode)
  const edges: GraphEdge[] = []
  dependencyTitles.forEach((dependencies, targetId) => {
    dependencies.forEach((title) => {
      const source = byTitle.get(title)
      if (source && source.id !== targetId) {
        edges.push({
          id: `${source.id}->${targetId}`,
          source: source.id,
          target: targetId,
        })
      }
    })
  })
  return { values, errors, edges, dependencyTitles }
}

function promptCallForNode(
  node: GraphNode,
  graphNodes: GraphNode[],
  values: Map<string, LispValue>,
) {
  const byTitle = new Map(graphNodes.map((candidate) => [candidate.title, candidate]))
  return evaluatePromptCall(nodeExpression(node), (name) => {
    const dependency = byTitle.get(name)
    if (!dependency) throw new Error(`'${name}' not found`)
    return values.get(dependency.id) ?? inferPipelineValue(dependency.markdown)
  })
}

function hasPromptFormula(node: GraphNode | null) {
  return Boolean(node && /^\(\s*prompt\s+/.test(nodeExpression(node)))
}

export default function CanvasBoard() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const boardRef = useRef<HTMLDivElement>(null)
  const nodesRef = useRef(STARTING_NODES)
  const edgesRef = useRef<GraphEdge[]>([])
  const selectedRef = useRef<string | null>('source')
  const transformRef = useRef(d3.zoomIdentity)
  const drawRef = useRef<() => void>(() => {})
  const zoomBehaviorRef = useRef<d3.ZoomBehavior<HTMLCanvasElement, unknown> | null>(null)
  const formulaEditorRef = useRef<FormulaEditorHandle>(null)
  const formulaOwnerRef = useRef<{ level: number | null; id: string } | null>(null)
  const formulaSelectionRef = useRef({ start: 0, end: 0 })

  const [nodes, setNodes] = useState(STARTING_NODES)
  const [diagramName, setDiagramName] = useState('Pipeline')
  const [parents, setParents] = useState<ParentDiagram[]>([])
  const [activeParentIndex, setActiveParentIndex] = useState<number | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>('source')
  const [transform, setTransform] = useState(d3.zoomIdentity)
  const [storageReady, setStorageReady] = useState(false)
  const [expandedJsonNodeId, setExpandedJsonNodeId] = useState<string | null>(null)
  const [nestedMetadata, setNestedMetadata] = useState<DiagramMetadata | null>(null)
  const [expandedParentTarget, setExpandedParentTarget] = useState<{
    level: number
    id: string
  } | null>(null)
  const [nestedParentMetadata, setNestedParentMetadata] = useState<DiagramMetadata | null>(null)
  const [promptRun, setPromptRun] = useState<{
    key: string
    status: 'running' | 'login_required' | 'error'
    message?: string
  } | null>(null)
  const evaluations = useMemo(() => evaluateGraphNodes(nodes), [nodes])
  const edges = evaluations.edges
  const selectedError = selectedId ? evaluations.errors.get(selectedId) : undefined
  const selectedNode = nodes.find((node) => node.id === selectedId) ?? null

  useEffect(() => {
    let storedNodes: GraphNode[] | null = null
    let storedDiagramName = 'Pipeline'
    let storedParents: ParentDiagram[] = []
    let storedActiveParentIndex: number | null = null
    let storedSelectedId: string | null = null
    let storedTransform = d3.zoomIdentity
    try {
      const stored = window.localStorage.getItem(GRAPH_STORAGE_KEY)
      if (stored) {
        const parsed: unknown = JSON.parse(stored)
        if (isStoredGraphState(parsed)) {
          storedDiagramName = parsed.diagramName
          storedParents = parsed.parents.map((parent) => ({
            ...parent,
            childPosition: parent.childPosition
              ?? { x: 160, y: 170, width: 420, height: 280 },
          }))
          storedActiveParentIndex = parsed.activeParentIndex
          storedNodes = parsed.nodes.map(migrateStoredNode)
          storedSelectedId = parsed.nodes.some((node) => node.id === parsed.selectedId)
            ? parsed.selectedId
            : parsed.nodes[0]?.id ?? null
          storedTransform = d3.zoomIdentity
            .translate(parsed.transform.x, parsed.transform.y)
            .scale(parsed.transform.k)
        } else if (isVersionThreeGraphState(parsed)) {
          const state = parsed as {
            diagramName: string
            upperDiagramName?: string | null
            showUpper?: boolean
            nodes: GraphNode[]
            selectedId: string | null
            transform: { x: number; y: number; k: number }
          }
          storedDiagramName = state.diagramName
          storedNodes = state.nodes.map(migrateStoredNode)
          storedSelectedId = state.selectedId
          storedTransform = d3.zoomIdentity
            .translate(state.transform.x, state.transform.y)
            .scale(state.transform.k)
          if (state.upperDiagramName) {
            storedParents = [{
              id: 'parent-0',
              name: state.upperDiagramName,
              nodes: [],
              selectedId: 'embedded-0',
              transform: { x: 0, y: 0, k: 1 },
              childPosition: { x: 160, y: 170, width: 420, height: 280 },
            }]
            storedActiveParentIndex = state.showUpper ? 0 : null
          }
        } else if (isVersionTwoGraphState(parsed)) {
          const state = parsed as {
            nodes: GraphNode[]
            selectedId: string | null
            transform: { x: number; y: number; k: number }
          }
          storedNodes = state.nodes.map(migrateStoredNode)
          storedSelectedId = state.nodes.some((node) => node.id === state.selectedId)
            ? state.selectedId
            : state.nodes[0]?.id ?? null
          storedTransform = d3.zoomIdentity
            .translate(state.transform.x, state.transform.y)
            .scale(state.transform.k)
        } else if (Array.isArray(parsed) && parsed.every(isStoredNode)) {
          // Migrate the original nodes-only storage payload.
          storedNodes = parsed.map(migrateStoredNode)
          storedSelectedId = parsed[0]?.id ?? null
        }
      }
    } catch {
      window.localStorage.removeItem(GRAPH_STORAGE_KEY)
    }

    queueMicrotask(() => {
      if (storedNodes) {
        setDiagramName(storedDiagramName)
        setParents(storedParents)
        setActiveParentIndex(storedActiveParentIndex)
        setNodes(storedNodes)
        setSelectedId(storedSelectedId)
        transformRef.current = storedTransform
        setTransform(storedTransform)
        const canvas = canvasRef.current
        const zoom = zoomBehaviorRef.current
        if (canvas && zoom) {
          d3.select(canvas).call(zoom.transform, storedTransform)
        }
      }
      setStorageReady(true)
    })
  }, [])

  useEffect(() => {
    if (!storageReady) return
    const saveTimer = window.setTimeout(() => {
      try {
        const state: StoredGraphState = {
          version: 4,
          diagramName,
          parents,
          activeParentIndex,
          nodes,
          selectedId,
          transform: {
            x: transform.x,
            y: transform.y,
            k: transform.k,
          },
        }
        window.localStorage.setItem(GRAPH_STORAGE_KEY, JSON.stringify(state))
      } catch {
        // Keep the in-memory graph usable when browser storage is unavailable.
      }
    }, 120)
    return () => window.clearTimeout(saveTimer)
  }, [activeParentIndex, diagramName, nodes, parents, selectedId, storageReady, transform])

  useEffect(() => {
    const captureFormulaCursor = () => {
      const textarea = formulaEditorRef.current
      if (textarea?.isFocused()) {
        formulaSelectionRef.current = textarea.getSelection()
      }
    }
    document.addEventListener('pointerdown', captureFormulaCursor, true)
    return () => document.removeEventListener('pointerdown', captureFormulaCursor, true)
  }, [])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return

    const ratio = window.devicePixelRatio || 1
    const { width, height } = canvas.getBoundingClientRect()
    const pixelWidth = Math.round(width * ratio)
    const pixelHeight = Math.round(height * ratio)
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth
      canvas.height = pixelHeight
    }

    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    context.clearRect(0, 0, width, height)
    const styles = getComputedStyle(canvas)
    const color = (name: string, fallback: string) =>
      styles.getPropertyValue(name).trim() || fallback
    context.fillStyle = color('--canvas-paper', '#f4f1ea')
    context.fillRect(0, 0, width, height)

    const currentTransform = transformRef.current
    context.save()
    context.translate(currentTransform.x, currentTransform.y)
    context.scale(currentTransform.k, currentTransform.k)

    const gridSize = 32
    const worldLeft = -currentTransform.x / currentTransform.k
    const worldTop = -currentTransform.y / currentTransform.k
    const worldRight = worldLeft + width / currentTransform.k
    const worldBottom = worldTop + height / currentTransform.k
    context.fillStyle = color('--canvas-grid', '#d6d1c7')
    const dotRadius = Math.max(1.2 / currentTransform.k, 0.7)
    for (let x = Math.floor(worldLeft / gridSize) * gridSize; x < worldRight; x += gridSize) {
      for (let y = Math.floor(worldTop / gridSize) * gridSize; y < worldBottom; y += gridSize) {
        context.beginPath()
        context.arc(x, y, dotRadius, 0, Math.PI * 2)
        context.fill()
      }
    }

    const byId = new Map(nodesRef.current.map((node) => [node.id, node]))
    context.lineWidth = 3 / currentTransform.k
    context.strokeStyle = color('--canvas-edge', '#746f66')
    edgesRef.current.forEach((edge) => {
      const source = byId.get(edge.source)
      const target = byId.get(edge.target)
      if (!source || !target) return
      const sourceHeight = displayedHeight(source, currentTransform.k)
      const targetHeight = displayedHeight(target, currentTransform.k)
      const sourceCenter = source.x + source.width / 2
      const targetCenter = target.x + target.width / 2
      const travelsRight = sourceCenter <= targetCenter
      const startX = travelsRight ? source.x + source.width : source.x
      const startY = source.y + sourceHeight / 2
      const endX = travelsRight ? target.x : target.x + target.width
      const endY = target.y + targetHeight / 2
      const curve = Math.max(90, Math.abs(endX - startX) * 0.55)
      context.beginPath()
      context.moveTo(startX, startY)
      context.bezierCurveTo(
        startX + (travelsRight ? curve : -curve),
        startY,
        endX + (travelsRight ? -curve : curve),
        endY,
        endX,
        endY,
      )
      context.stroke()
    })

    nodesRef.current.forEach((node) => {
      const isSelected = selectedRef.current === node.id
      const compact = isNodeCompact(node, currentTransform.k)
      const nodeHeight = displayedHeight(node, currentTransform.k)
      context.shadowColor = color('--canvas-shadow', 'rgba(40, 35, 28, 0.14)')
      context.shadowBlur = 18 / currentTransform.k
      context.shadowOffsetY = 6 / currentTransform.k
      roundedRect(context, node.x, node.y, node.width, nodeHeight, 18)
      context.fillStyle = isSelected
        ? color('--canvas-node-selected', '#fffdf7')
        : color('--canvas-node', '#fbfaf6')
      context.fill()
      context.shadowColor = 'transparent'
      context.lineWidth = (isSelected ? 3 : 1.5) / currentTransform.k
      context.strokeStyle = isSelected
        ? color('--canvas-accent', '#ed6a3a')
        : color('--canvas-node-border', '#a8a196')
      context.stroke()

      if (!compact) {
        context.beginPath()
        context.moveTo(node.x, node.y + TITLE_HEIGHT)
        context.lineTo(node.x + node.width, node.y + TITLE_HEIGHT)
        context.lineWidth = 1 / currentTransform.k
        context.strokeStyle = color('--canvas-divider', '#d7d1c8')
        context.stroke()
      }

      if (compact) {
        context.fillStyle = color('--canvas-ink', '#26231f')
        context.font = '700 25px "Roboto Condensed", sans-serif'
        context.textBaseline = 'middle'
        context.fillText(node.title, node.x + 18, node.y + nodeHeight / 2, node.width - 36)
      }

      context.fillStyle = isSelected
        ? color('--canvas-accent', '#ed6a3a')
        : color('--canvas-muted', '#8a847b')
      context.beginPath()
      context.arc(node.x + node.width - 20, node.y + (compact ? 33 : 21), 5, 0, Math.PI * 2)
      context.fill()
    })

    context.restore()
  }, [])

  useEffect(() => {
    nodesRef.current = nodes
    edgesRef.current = edges
    selectedRef.current = selectedId
    transformRef.current = transform
    drawRef.current = draw
  }, [draw, edges, nodes, selectedId, transform])

  useEffect(() => {
    draw()
  }, [draw, nodes, edges, selectedId, transform])

  useEffect(() => {
    const canvas = canvasRef.current
    const board = boardRef.current
    if (!canvas || !board) return

    const zoom = d3.zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.18, 2.5])
      .filter((event) => {
        if (event.type === 'wheel') return false
        return !event.button && !event.ctrlKey
      })
      .on('zoom', (event) => {
        transformRef.current = event.transform
        setTransform(event.transform)
        drawRef.current()
      })

    const selection = d3.select(canvas)
    zoomBehaviorRef.current = zoom
    selection.call(zoom)
    selection.on('dblclick.zoom', null)

    const capturePinch = (event: WheelEvent) => {
      if (!event.ctrlKey) return
      event.preventDefault()
      event.stopPropagation()

      const bounds = board.getBoundingClientRect()
      const point: [number, number] = [
        event.clientX - bounds.left,
        event.clientY - bounds.top,
      ]
      const current = transformRef.current
      const nextScale = Math.max(0.18, Math.min(2.5, current.k * Math.exp(-event.deltaY * 0.01)))
      if (nextScale === current.k) return
      const worldPoint = current.invert(point)
      const next = d3.zoomIdentity
        .translate(
          point[0] - worldPoint[0] * nextScale,
          point[1] - worldPoint[1] * nextScale,
        )
        .scale(nextScale)
      selection.call(zoom.transform, next)
    }
    board.addEventListener('wheel', capturePinch, { capture: true, passive: false })

    const resizeObserver = new ResizeObserver(() => drawRef.current())
    resizeObserver.observe(board)

    return () => {
      resizeObserver.disconnect()
      board.removeEventListener('wheel', capturePinch, { capture: true })
      selection.on('.zoom', null)
      zoomBehaviorRef.current = null
    }
  }, [])

  function selectNode(id: string) {
    selectedRef.current = id
    setSelectedId(id)
  }

  function addNode() {
    const title = randomTitle(nodes)
    const id = title
    const viewportCenter = transform.invert([
      (boardRef.current?.clientWidth ?? 1000) / 2,
      (boardRef.current?.clientHeight ?? 700) / 2,
    ])
    const newNode: GraphNode = {
      id,
      title,
      x: viewportCenter[0] - 195,
      y: viewportCenter[1] - 135,
      width: 390,
      height: 270,
      markdown: `# ${title}\n\nWrite Markdown here. Reference this node as \`${title}\`.`,
      formula: '',
    }
    setNodes((current) => [...current, newNode])
    selectNode(id)
  }

  function updateNode(id: string, patch: Partial<GraphNode>) {
    setNodes((current) => current.map((node) => node.id === id ? { ...node, ...patch } : node))
  }

  function renameNode(id: string, requestedTitle: string) {
    const title = safeTitle(requestedTitle)
    if (!title) return
    setNodes((current) => {
      const node = current.find((candidate) => candidate.id === id)
      if (!node || node.title === title) return current
      return current.map((candidate) => ({
        ...candidate,
        title: candidate.id === id ? title : candidate.title,
        formula: replaceFormulaSymbol(candidate.formula, node.title, title),
      }))
    })
  }

  function renameDiagram(level: number | null, requestedTitle: string) {
    const title = safeTitle(requestedTitle)
    if (!title) return
    if (level === null) {
      const previous = diagramName
      if (previous === title) return
      setDiagramName(title)
      setParents((current) => current.map((parent, index) =>
        index === 0
          ? {
              ...parent,
              nodes: parent.nodes.map((node) => ({
                ...node,
                formula: replaceFormulaSymbol(node.formula, previous, title),
              })),
            }
          : parent))
      return
    }
    const previous = parents[level]?.name
    if (!previous || previous === title) return
    setParents((current) => current.map((parent, index) => {
      if (index === level) return { ...parent, name: title }
      if (index === level + 1) {
        return {
          ...parent,
          nodes: parent.nodes.map((node) => ({
            ...node,
            formula: replaceFormulaSymbol(node.formula, previous, title),
          })),
        }
      }
      return parent
    }))
  }

  function deleteSelectedNode() {
    if (!selectedId) return
    setNodes((current) => current.filter((node) => node.id !== selectedId))
    selectedRef.current = null
    formulaOwnerRef.current = null
    setSelectedId(null)
  }

  function duplicateSelectedNode() {
    if (!selectedNode) return
    const title = randomTitle(nodes)
    let id = `${selectedNode.id}-copy`
    let suffix = 2
    const ids = new Set(nodes.map((node) => node.id))
    while (ids.has(id)) {
      id = `${selectedNode.id}-copy-${suffix}`
      suffix += 1
    }
    const duplicate: GraphNode = {
      ...selectedNode,
      id,
      title,
      x: selectedNode.x + 36,
      y: selectedNode.y + 36,
    }
    setNodes((current) => [...current, duplicate])
    selectNode(id)
  }

  function insertNodeReference(
    reference: { id: string; title: string },
    level: number | null,
  ) {
    const selectedOwnerId = level === null
      ? selectedId
      : parents[level]?.selectedId ?? null
    const ownerRef = formulaOwnerRef.current
      ?? (document.querySelector('.json-fullscreen') && selectedOwnerId
        ? { level, id: selectedOwnerId }
        : null)
    if (!ownerRef || ownerRef.level !== level || ownerRef.id === reference.id) return false
    const graphNodes = level === null ? nodesRef.current : parents[level]?.nodes ?? []
    const owner = graphNodes.find((candidate) => candidate.id === ownerRef.id)
    if (!owner) return false
    const editor = formulaEditorRef.current
    if (!editor) return false
    const source = editor.getValue()
    const { start, end } = editor.getSelection()
    const formula = `${source.slice(0, start)}${reference.title}${source.slice(end)}`
    const cursor = start + reference.title.length
    if (level === null) {
      updateNode(owner.id, { formula })
      selectedRef.current = owner.id
      setSelectedId(owner.id)
    } else {
      setParents((current) => current.map((parent, index) =>
        index === level
          ? {
              ...parent,
              selectedId: owner.id,
              nodes: parent.nodes.map((node) =>
                node.id === owner.id ? { ...node, formula } : node),
            }
          : parent))
    }
    formulaSelectionRef.current = { start: cursor, end: cursor }
    queueMicrotask(() => {
      formulaEditorRef.current?.focus()
      formulaEditorRef.current?.setSelection(cursor)
    })
    return true
  }

  async function runPromptNode(
    node: GraphNode,
    level: number | null,
    graphNodes: GraphNode[],
    values: Map<string, LispValue>,
  ) {
    const key = `${level ?? 'root'}:${node.id}`
    try {
      const call = promptCallForNode(node, graphNodes, values)
      if (!call) throw new Error('formula must be (prompt chatgpt <string>)')
      if (call.engine !== 'chatgpt') throw new Error(`unsupported prompt engine '${call.engine}'`)
      setPromptRun({ key, status: 'running' })
      const response = await fetch('/api/prompt', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ engine: call.engine, prompt: call.prompt }),
      })
      const result = await response.json() as {
        status?: string
        text?: string
        message?: string
        error?: string
      }
      if (response.status === 409 && result.status === 'login_required') {
        setPromptRun({
          key,
          status: 'login_required',
          message: result.message,
        })
        return
      }
      if (!response.ok || typeof result.text !== 'string') {
        throw new Error(result.error ?? 'ChatGPT prompt failed')
      }
      if (level === null) {
        updateNode(node.id, { markdown: result.text })
      } else {
        setParents((current) => current.map((parent, index) =>
          index === level
            ? {
                ...parent,
                nodes: parent.nodes.map((candidate) =>
                  candidate.id === node.id ? { ...candidate, markdown: result.text! } : candidate),
              }
            : parent))
      }
      setPromptRun(null)
    } catch (error) {
      setPromptRun({
        key,
        status: 'error',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const expandedJsonNode = expandedJsonNodeId
    ? nodes.find((node) => node.id === expandedJsonNodeId) ?? null
    : null
  const expandedJsonValue = expandedJsonNode
    ? nodeExpression(expandedJsonNode)
      ? printPipelineValue(evaluations.values.get(expandedJsonNode.id) ?? null)
      : expandedJsonNode.markdown
    : ''
  const expandedDependentPaths = expandedJsonNode
    ? nodes.flatMap((node) => {
        if (node.id === expandedJsonNode.id) return []
        const tokens = node.formula.match(/"(?:\\.|[^\\"])*"|;[^\n]*|[^\s()[\]{}",;]+/g) ?? []
        return tokens.flatMap((token) => token.startsWith(`${expandedJsonNode.title}.`)
          ? [token.slice(expandedJsonNode.title.length + 1)]
          : [])
      })
    : []
  const currentDiagramJson = useMemo(() => JSON.stringify({
    ...Object.fromEntries(nodes.map((node) => [
      node.title,
      nodeExpression(node)
        ? {
            formula: nodeExpression(node),
            value: printPipelineValue(evaluations.values.get(node.id) ?? null),
          }
        : pipelineValueToJson(inferPipelineValue(node.markdown)),
    ])),
  }, null, 2), [evaluations.values, nodes])

  function enterJsonDiagram(node: GraphNode, displayedValue: string) {
    let layout = normalizeDiagramMetadata(node.jsonLayout, node.title)
    if (!layout) {
      try {
        const parsed = parsePipelineJson5(displayedValue)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return
        const keys = Object.keys(parsed)
        layout = {
          name: node.title,
          viewport: { x: 0, y: 0, k: 1 },
          positions: Object.fromEntries(keys.map((key, index) => [
            key,
            {
              x: 100 + (index % 3) * 430,
              y: 120 + Math.floor(index / 3) * 310,
              width: 360,
              height: 240,
            },
          ])),
        }
      } catch {
        return
      }
    }
    updateNode(node.id, { jsonLayout: layout })
    setNestedMetadata(layout)
    setExpandedJsonNodeId(node.id)
  }

  const rootDiagramPath = [
    ...parents.slice().reverse().map((parent) => parent.name),
    diagramName,
  ]
  const rootPortalEdges = parentDependencyEdges(
    nodes,
    diagramName,
    parents[0],
    Math.max(0, rootDiagramPath.length - 2),
  )
  const rootSurfaceNodes = nodes.map((node) => {
    const expression = nodeExpression(node)
    const displayedValue = expression
      ? evaluations.errors.get(node.id)
        ? `Evaluation error: ${evaluations.errors.get(node.id)}`
        : printPipelineValue(evaluations.values.get(node.id) ?? null)
      : node.markdown
    const displayedType = classifyPipelineSource(displayedValue)
    return {
      id: node.id,
      title: node.title,
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      canEnter: editorMode(displayedValue) !== 'markdown',
      content: displayedType === 'csv' ? (
        <CsvSpreadsheet
          label={`${node.title} CSV spreadsheet`}
          value={displayedValue}
          pathPrefix={node.title}
          onChange={!expression
            ? (markdown) => updateNode(node.id, { markdown })
            : undefined}
          onFocus={() => {
            if (formulaOwnerRef.current?.level === null
              && formulaOwnerRef.current.id !== node.id) return
            selectNode(node.id)
          }}
        />
      ) : (
        <MarkdownLiveEditor
          label={
            expression
              ? `${node.title} evaluated Markdown`
              : `Edit ${node.title} Markdown`
          }
          value={displayedValue}
          onChange={(markdown) => {
            if (!expression) updateNode(node.id, { markdown })
          }}
          onFocus={() => {
            if (formulaOwnerRef.current?.level === null
              && formulaOwnerRef.current.id !== node.id) return
            selectNode(node.id)
          }}
          readOnly={Boolean(expression)}
          mode={editorMode(displayedValue)}
          onShowDiagram={
            editorMode(displayedValue) !== 'markdown'
              ? () => enterJsonDiagram(node, displayedValue)
              : undefined
          }
          onClear={
            !expression && editorMode(displayedValue) !== 'markdown'
              ? () => updateNode(node.id, { markdown: '' })
              : undefined
          }
        />
      ),
    }
  })
  const parentDiagramJsons = useMemo(() => {
    const serialized: string[] = []
    let childJson = currentDiagramJson
    parents.forEach((parent, index) => {
      const childName = index === 0 ? diagramName : parents[index - 1].name
      const childId = `embedded-${index}`
      const levelEvaluations = evaluateGraphNodes([{
        id: childId,
        title: childName,
        x: 0,
        y: 0,
        width: 220,
        height: 150,
        markdown: childJson,
        formula: '',
      }, ...parent.nodes])
      let childValue: unknown = childJson
      try {
        childValue = JSON.parse(childJson)
      } catch {
        // Keep the serialized child visible if an old stored value is malformed.
      }
      childJson = JSON.stringify({
        [childName]: childValue,
        ...Object.fromEntries(parent.nodes.map((node) => [
          node.title,
          nodeExpression(node)
            ? {
                formula: nodeExpression(node),
                value: printPipelineValue(levelEvaluations.values.get(node.id) ?? null),
              }
            : pipelineValueToJson(inferPipelineValue(node.markdown)),
        ])),
      }, null, 2)
      serialized.push(childJson)
    })
    return serialized
  }, [currentDiagramJson, diagramName, parents])
  const activeParent = activeParentIndex === null ? null : parents[activeParentIndex] ?? null
  const activeParentPath = activeParentIndex === null
    ? []
    : parents.slice(activeParentIndex).reverse().map((parent) => parent.name)
  const activeParentSelectedNode = activeParent?.nodes.find(
    (node) => node.id === activeParent.selectedId,
  ) ?? null
  const activeChildName = activeParentIndex === null
    ? diagramName
    : activeParentIndex === 0
      ? diagramName
      : parents[activeParentIndex - 1].name
  const activeChildJson = activeParentIndex === null || activeParentIndex === 0
    ? currentDiagramJson
    : parentDiagramJsons[activeParentIndex - 1]
  const embeddedNodeId = activeParentIndex === null ? '' : `embedded-${activeParentIndex}`
  const activeParentEvaluationNodes = useMemo(() => {
    if (!activeParent) return []
    return [{
      id: embeddedNodeId,
      title: activeChildName,
      x: activeParent.childPosition?.x ?? 160,
      y: activeParent.childPosition?.y ?? 170,
      width: activeParent.childPosition?.width ?? 420,
      height: activeParent.childPosition?.height ?? 280,
      markdown: activeChildJson,
      formula: '',
    }, ...activeParent.nodes]
  }, [activeChildJson, activeChildName, activeParent, embeddedNodeId])
  const activeParentEvaluations = useMemo(
    () => evaluateGraphNodes(activeParentEvaluationNodes),
    [activeParentEvaluationNodes],
  )
  function enterParentJsonDiagram(node: GraphNode, displayedValue: string) {
    if (activeParentIndex === null) return
    let layout = normalizeDiagramMetadata(node.jsonLayout, node.title)
    if (!layout) {
      try {
        const parsed = parsePipelineJson5(displayedValue)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return
        layout = {
          name: node.title,
          viewport: { x: 0, y: 0, k: 1 },
          positions: Object.fromEntries(Object.keys(parsed).map((key, index) => [
            key,
            {
              x: 100 + (index % 3) * 430,
              y: 120 + Math.floor(index / 3) * 310,
              width: 360,
              height: 240,
            },
          ])),
        }
      } catch {
        return
      }
    }
    const level = activeParentIndex
    setParents((current) => current.map((parent, index) =>
      index === level
        ? {
            ...parent,
            nodes: parent.nodes.map((candidate) =>
              candidate.id === node.id ? { ...candidate, jsonLayout: layout } : candidate),
          }
        : parent))
    setNestedParentMetadata(layout)
    setExpandedParentTarget({ level, id: node.id })
  }
  const embeddedDiagramNode = {
    id: embeddedNodeId,
    title: activeChildName,
    x: activeParent?.childPosition?.x ?? 160,
    y: activeParent?.childPosition?.y ?? 170,
    width: activeParent?.childPosition?.width ?? 420,
    height: activeParent?.childPosition?.height ?? 280,
    canEnter: true,
    content: (
      <MarkdownLiveEditor
        label={`${activeChildName} diagram JSON`}
        value={activeChildJson}
        onChange={() => {}}
        onFocus={() => {
          if (activeParentIndex === null) return
          setParents((current) => current.map((parent, index) =>
            index === activeParentIndex ? { ...parent, selectedId: embeddedNodeId } : parent))
        }}
        readOnly
        mode="json"
        onShowDiagram={() => setActiveParentIndex((index) =>
          index === null || index === 0 ? null : index - 1)}
      />
    ),
  }
  const parentSurfaceNodes = [
    embeddedDiagramNode,
    ...(activeParent?.nodes ?? []).map((node) => {
      const expression = nodeExpression(node)
      const displayedValue = expression
        ? activeParentEvaluations.errors.get(node.id)
          ? `Evaluation error: ${activeParentEvaluations.errors.get(node.id)}`
          : printPipelineValue(activeParentEvaluations.values.get(node.id) ?? null)
        : node.markdown
      const displayedType = classifyPipelineSource(displayedValue)
      return {
      id: node.id,
      title: node.title,
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      canEnter: editorMode(displayedValue) !== 'markdown',
      content: displayedType === 'csv' ? (
        <CsvSpreadsheet
          label={`${node.title} CSV spreadsheet`}
          value={displayedValue}
          pathPrefix={node.title}
          onChange={!expression && activeParentIndex !== null
            ? (markdown) => setParents((current) => current.map((parent, index) =>
                index === activeParentIndex
                  ? {
                      ...parent,
                      nodes: parent.nodes.map((candidate) =>
                        candidate.id === node.id ? { ...candidate, markdown } : candidate),
                    }
                  : parent))
            : undefined}
          onFocus={() => {
            if (activeParentIndex === null) return
            if (formulaOwnerRef.current?.level === activeParentIndex
              && formulaOwnerRef.current.id !== node.id) return
            setParents((current) => current.map((parent, index) =>
              index === activeParentIndex ? { ...parent, selectedId: node.id } : parent))
          }}
        />
      ) : (
        <MarkdownLiveEditor
          label={expression ? `${node.title} evaluated Markdown` : `Edit ${node.title} Markdown`}
          value={displayedValue}
          onChange={(markdown) => {
            if (activeParentIndex === null || expression) return
            setParents((current) => current.map((parent, index) =>
              index === activeParentIndex
                ? {
                    ...parent,
                    nodes: parent.nodes.map((candidate) =>
                      candidate.id === node.id ? { ...candidate, markdown } : candidate),
                  }
                : parent))
          }}
          onFocus={() => {
            if (activeParentIndex === null) return
            if (formulaOwnerRef.current?.level === activeParentIndex
              && formulaOwnerRef.current.id !== node.id) return
            setParents((current) => current.map((parent, index) =>
              index === activeParentIndex ? { ...parent, selectedId: node.id } : parent))
          }}
          readOnly={Boolean(expression)}
          mode={editorMode(displayedValue)}
          onShowDiagram={
            editorMode(displayedValue) !== 'markdown'
              ? () => enterParentJsonDiagram(node, displayedValue)
              : undefined
          }
        />
      ),
    }}),
  ]
  const expandedParentDiagram = expandedParentTarget
    ? parents[expandedParentTarget.level]
    : null
  const expandedParentNode = expandedParentDiagram?.nodes.find(
    (node) => node.id === expandedParentTarget?.id,
  ) ?? null
  const expandedParentValue = expandedParentNode
    ? nodeExpression(expandedParentNode)
      ? printPipelineValue(activeParentEvaluations.values.get(expandedParentNode.id) ?? null)
      : expandedParentNode.markdown
    : ''
  const expandedParentDependentPaths = expandedParentNode && expandedParentDiagram
    ? expandedParentDiagram.nodes.flatMap((node) => {
        if (node.id === expandedParentNode.id) return []
        const tokens = node.formula.match(/"(?:\\.|[^\\"])*"|;[^\n]*|[^\s()[\]{}",;]+/g) ?? []
        return tokens.flatMap((token) => token.startsWith(`${expandedParentNode.title}.`)
          ? [token.slice(expandedParentNode.title.length + 1)]
          : [])
      })
    : []
  const activeParentPortalEdges = activeParent && activeParentIndex !== null
    ? parentDependencyEdges(
        activeParent.nodes,
        activeParent.name,
        parents[activeParentIndex + 1],
        Math.max(0, activeParentPath.length - 2),
      )
    : []

  return (
    <main className="app-shell">
      {activeParent && activeParentIndex !== null ? (
        <DiagramSurface
          ariaLabel={`${activeParent.name} diagram`}
          namePath={activeParentPath}
          nodes={parentSurfaceNodes}
          edges={[
            ...activeParentEvaluations.edges.map((edge) => ({
              ...edge,
              portal: edge.source === embeddedNodeId,
            })),
            ...activeParentPortalEdges,
          ]}
          selectedId={activeParent.selectedId}
          transform={activeParent.transform}
          onTransform={(nextTransform) => setParents((current) => current.map((parent, index) =>
            index === activeParentIndex ? { ...parent, transform: nextTransform } : parent))}
          onSelect={(id) => {
            if (!id) formulaOwnerRef.current = null
            if (id && formulaOwnerRef.current?.level === activeParentIndex) {
              const reference = id === embeddedNodeId
                ? { id, title: activeChildName }
                : activeParent.nodes.find((node) => node.id === id)
              if (reference && insertNodeReference(reference, activeParentIndex)) return true
            }
            setParents((current) => current.map((parent, index) =>
              index === activeParentIndex ? { ...parent, selectedId: id } : parent))
          }}
          onReferenceSelect={(path) => insertNodeReference({
            id: path,
            title: path,
          }, activeParentIndex)}
          onMove={(id, x, y) => {
            setParents((current) => current.map((parent, index) =>
              index === activeParentIndex
                ? id === embeddedNodeId
                  ? { ...parent, childPosition: { ...parent.childPosition, x, y } }
                  : { ...parent, nodes: parent.nodes.map((node) => node.id === id ? { ...node, x, y } : node) }
                : parent))
          }}
          onResize={(id, width, height) => {
            setParents((current) => current.map((parent, index) =>
              index === activeParentIndex
                ? id === embeddedNodeId
                  ? { ...parent, childPosition: { ...parent.childPosition, width, height } }
                  : {
                      ...parent,
                      nodes: parent.nodes.map((node) =>
                        node.id === id ? { ...node, width, height } : node),
                    }
                : parent))
          }}
          onRename={(id, title) => {
            const name = safeTitle(title)
            if (!name) return
            if (id === embeddedNodeId) {
              renameDiagram(activeParentIndex === 0 ? null : activeParentIndex - 1, name)
            } else {
              setParents((current) => current.map((parent, index) =>
                index === activeParentIndex
                  ? {
                      ...parent,
                      nodes: parent.nodes.map((node) => ({
                        ...node,
                        title: node.id === id ? name : node.title,
                        formula: replaceFormulaSymbol(
                          node.formula,
                          parent.nodes.find((candidate) => candidate.id === id)?.title ?? name,
                          name,
                        ),
                      })),
                    }
                  : parent))
            }
          }}
          onRenamePath={(pathIndex, title) => {
            const name = safeTitle(title)
            if (!name) return
            const parentIndex = parents.length - 1 - pathIndex
            renameDiagram(parentIndex, name)
          }}
          onAdd={() => {
            const title = randomTitle([...nodes, ...parents.flatMap((parent) => parent.nodes)])
            const id = `parent-${activeParentIndex}-${title}`
            setParents((current) => current.map((parent, index) =>
              index === activeParentIndex
                ? {
                    ...parent,
                    selectedId: id,
                    nodes: [...parent.nodes, {
                      id,
                      title,
                      x: 640 + parent.nodes.length * 40,
                      y: 180 + parent.nodes.length * 40,
                      width: 390,
                      height: 270,
                      markdown: `# ${title}`,
                      formula: '',
                    }],
                  }
                : parent))
          }}
          onCopy={() => {
            const content = parentDiagramJsons[activeParentIndex] ?? activeChildJson
            void copyText(content)
          }}
          onUp={() => {
            const nextIndex = activeParentIndex + 1
            setParents((current) => {
              if (current[nextIndex]) return current
              const name = randomTitle([...nodes, ...current.flatMap((parent) => parent.nodes)])
              return [...current, {
                id: `parent-${nextIndex}`,
                name,
                nodes: [],
                selectedId: `embedded-${nextIndex}`,
                transform: { x: 0, y: 0, k: 1 },
                childPosition: { x: 160, y: 170, width: 420, height: 280 },
              }]
            })
            setActiveParentIndex(nextIndex)
          }}
          onEnter={(id) => {
            if (id === embeddedNodeId) {
              setActiveParentIndex(activeParentIndex === 0 ? null : activeParentIndex - 1)
              return
            }
            const node = activeParent.nodes.find((candidate) => candidate.id === id)
            if (!node) return
            const displayedValue = nodeExpression(node)
              ? printPipelineValue(activeParentEvaluations.values.get(node.id) ?? null)
              : node.markdown
            if (editorMode(displayedValue) !== 'markdown') {
              enterParentJsonDiagram(node, displayedValue)
            }
          }}
        />
      ) : (
      <DiagramSurface
        ariaLabel="Pipeline canvas"
        namePath={rootDiagramPath}
        nodes={rootSurfaceNodes}
        edges={[...edges, ...rootPortalEdges]}
        selectedId={selectedId}
        transform={{ x: transform.x, y: transform.y, k: transform.k }}
        onTransform={(next) => {
          const zoom = d3.zoomIdentity.translate(next.x, next.y).scale(next.k)
          transformRef.current = zoom
          setTransform(zoom)
        }}
        onSelect={(id) => {
          if (!id) formulaOwnerRef.current = null
          if (id && formulaOwnerRef.current?.level === null && formulaOwnerRef.current.id !== id) {
            const node = nodes.find((candidate) => candidate.id === id)
            if (node && insertNodeReference(node, null)) return true
          }
          if (id) selectNode(id)
          else setSelectedId(null)
        }}
        onReferenceSelect={(path) => insertNodeReference({
          id: path,
          title: path,
        }, null)}
        onMove={(id, x, y) => updateNode(id, { x, y })}
        onResize={(id, width, height) => updateNode(id, { width, height })}
        onRename={renameNode}
        onRenamePath={(pathIndex, title) => {
          const name = safeTitle(title)
          if (!name) return
          if (pathIndex === rootDiagramPath.length - 1) {
            renameDiagram(null, name)
            return
          }
          const parentIndex = parents.length - 1 - pathIndex
          renameDiagram(parentIndex, name)
        }}
        onAdd={addNode}
        onCopy={() => {
          void copyText(currentDiagramJson)
        }}
        onUp={() => {
          setParents((current) => current.length > 0 ? current : [{
            id: 'parent-0',
            name: randomTitle(nodes),
            nodes: [],
            selectedId: 'embedded-0',
            transform: { x: 0, y: 0, k: 1 },
            childPosition: { x: 160, y: 170, width: 420, height: 280 },
          }])
          setActiveParentIndex(0)
        }}
        onEnter={(id) => {
          const node = nodes.find((candidate) => candidate.id === id)
          if (!node) return
          const displayedValue = nodeExpression(node)
            ? printPipelineValue(evaluations.values.get(node.id) ?? null)
            : node.markdown
          if (editorMode(displayedValue) !== 'markdown') enterJsonDiagram(node, displayedValue)
        }}
      />
      )}

      <aside className="inspector" aria-label="Inspector">
        {activeParentIndex === null && selectedNode && (
          <div className="value-inspector">
            <FormulaEditor
              key={selectedNode.id}
              ref={formulaEditorRef}
              value={nodeExpression(selectedNode)}
              onChange={(formula) => {
                updateNode(
                  selectedNode.id,
                  !selectedNode.formula.trim()
                    && classifyPipelineSource(selectedNode.markdown) === 'lisp'
                    ? { markdown: formula }
                    : { formula },
                )
              }}
              onFocus={() => {
                formulaOwnerRef.current = { level: null, id: selectedNode.id }
              }}
              onSelectionChange={(selection) => {
                formulaSelectionRef.current = selection
              }}
              onBlur={() => {
                window.setTimeout(() => {
                  if (document.querySelector('.json-fullscreen')) return
                  if (!formulaEditorRef.current?.isFocused()) {
                    formulaOwnerRef.current = null
                  }
                }, 0)
              }}
              label={`Edit ${selectedNode.title} formula`}
            />
            {hasPromptFormula(selectedNode) && (
              <div className="prompt-run-panel">
                <button
                  type="button"
                  className="prompt-run-button"
                  disabled={promptRun?.key === `root:${selectedNode.id}`
                    && promptRun.status === 'running'}
                  onClick={() => void runPromptNode(
                    selectedNode,
                    null,
                    nodes,
                    evaluations.values,
                  )}
                >
                  {promptRun?.key === `root:${selectedNode.id}`
                    && promptRun.status === 'running'
                    ? 'Running…'
                    : 'Run prompt'}
                </button>
                {promptRun?.key === `root:${selectedNode.id}` && promptRun.message && (
                  <span className={`prompt-run-status is-${promptRun.status}`}>
                    {promptRun.message}
                  </span>
                )}
              </div>
            )}
            {editorMode(
              nodeExpression(selectedNode)
                ? printPipelineValue(evaluations.values.get(selectedNode.id) ?? null)
                : selectedNode.markdown,
            ) !== 'markdown' && (
              <pre className="diagram-metadata-detail" aria-label="Diagram metadata">
                {JSON.stringify(
                  selectedNode.id === expandedJsonNodeId && nestedMetadata
                    ? nestedMetadata
                    : selectedNode.jsonLayout ?? null,
                  null,
                  2,
                )}
              </pre>
            )}
            {selectedError && (
              <pre className="evaluation-error">{selectedError}</pre>
            )}
            <div className="inspector-actions">
              <button
                type="button"
                className="node-action-button"
                onClick={duplicateSelectedNode}
                aria-label="Duplicate selected node"
                title="Duplicate selected node"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="8" y="8" width="11" height="11" rx="2" />
                  <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
                </svg>
              </button>
              <button
                type="button"
                className="node-action-button is-danger"
                onClick={deleteSelectedNode}
                aria-label="Delete selected node"
                title="Delete selected node"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" />
                </svg>
              </button>
            </div>
          </div>
        )}
        {activeParentIndex !== null && activeParentSelectedNode && (
          <div className="value-inspector">
            <FormulaEditor
              key={activeParentSelectedNode.id}
              ref={formulaEditorRef}
              value={nodeExpression(activeParentSelectedNode)}
              onChange={(formula) => {
                setParents((current) => current.map((parent, index) =>
                  index === activeParentIndex
                    ? {
                        ...parent,
                        nodes: parent.nodes.map((node) =>
                          node.id === activeParentSelectedNode.id
                            ? !activeParentSelectedNode.formula.trim()
                              && classifyPipelineSource(activeParentSelectedNode.markdown) === 'lisp'
                              ? { ...node, markdown: formula }
                              : { ...node, formula }
                            : node),
                      }
                    : parent))
              }}
              onFocus={() => {
                formulaOwnerRef.current = {
                  level: activeParentIndex,
                  id: activeParentSelectedNode.id,
                }
              }}
              onSelectionChange={(selection) => {
                formulaSelectionRef.current = selection
              }}
              onBlur={() => {
                window.setTimeout(() => {
                  if (document.querySelector('.json-fullscreen')) return
                  if (!formulaEditorRef.current?.isFocused()) {
                    formulaOwnerRef.current = null
                  }
                }, 0)
              }}
              label={`Edit ${activeParentSelectedNode.title} formula`}
            />
            {hasPromptFormula(activeParentSelectedNode) && (
              <div className="prompt-run-panel">
                <button
                  type="button"
                  className="prompt-run-button"
                  disabled={promptRun?.key === `${activeParentIndex}:${activeParentSelectedNode.id}`
                    && promptRun.status === 'running'}
                  onClick={() => void runPromptNode(
                    activeParentSelectedNode,
                    activeParentIndex,
                    activeParentEvaluationNodes,
                    activeParentEvaluations.values,
                  )}
                >
                  {promptRun?.key === `${activeParentIndex}:${activeParentSelectedNode.id}`
                    && promptRun.status === 'running'
                    ? 'Running…'
                    : 'Run prompt'}
                </button>
                {promptRun?.key === `${activeParentIndex}:${activeParentSelectedNode.id}`
                  && promptRun.message && (
                  <span className={`prompt-run-status is-${promptRun.status}`}>
                    {promptRun.message}
                  </span>
                )}
              </div>
            )}
            <div className="inspector-actions">
              <button
                type="button"
                className="node-action-button"
                onClick={() => {
                  const title = randomTitle([...nodes, ...parents.flatMap((parent) => parent.nodes)])
                  const id = `${activeParentSelectedNode.id}-copy-${Date.now().toString(36)}`
                  setParents((current) => current.map((parent, index) =>
                    index === activeParentIndex
                      ? {
                          ...parent,
                          selectedId: id,
                          nodes: [...parent.nodes, {
                            ...activeParentSelectedNode,
                            id,
                            title,
                            x: activeParentSelectedNode.x + 36,
                            y: activeParentSelectedNode.y + 36,
                          }],
                        }
                      : parent))
                }}
                aria-label="Duplicate selected node"
                title="Duplicate selected node"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="8" y="8" width="11" height="11" rx="2" />
                  <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
                </svg>
              </button>
              <button
                type="button"
                className="node-action-button is-danger"
                onClick={() => {
                  formulaOwnerRef.current = null
                  setParents((current) => current.map((parent, index) =>
                    index === activeParentIndex
                      ? {
                          ...parent,
                          selectedId: null,
                          nodes: parent.nodes.filter((node) => node.id !== activeParentSelectedNode.id),
                        }
                      : parent))
                }}
                aria-label="Delete selected node"
                title="Delete selected node"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" />
                </svg>
              </button>
            </div>
          </div>
        )}
      </aside>
      {expandedJsonNode && editorMode(expandedJsonValue) !== 'markdown' && (
        <div className="json-fullscreen" role="dialog" aria-modal="true" aria-label={`${expandedJsonNode.title} diagram`}>
          <JsonGraphDiagram
            namePath={[...rootDiagramPath, expandedJsonNode.title]}
            value={expandedJsonValue}
            metadata={nestedMetadata ?? expandedJsonNode.jsonLayout ?? {
              name: expandedJsonNode.title,
              viewport: { x: 0, y: 0, k: 1 },
              positions: {},
            }}
            dependentPaths={expandedDependentPaths}
            onReferenceSelect={(path) => insertNodeReference({
              id: `${expandedJsonNode.id}.${path}`,
              title: `${expandedJsonNode.title}.${path}`,
            }, null)}
            onMetadataChange={(metadata) => {
              setNestedMetadata(metadata)
              updateNode(expandedJsonNode.id, { jsonLayout: metadata })
            }}
            onChange={!nodeExpression(expandedJsonNode)
              ? (value) => updateNode(expandedJsonNode.id, { markdown: value })
              : undefined}
            onUp={() => setExpandedJsonNodeId(null)}
          />
        </div>
      )}
      {expandedParentNode
        && expandedParentDiagram
        && expandedParentTarget
        && editorMode(expandedParentValue) !== 'markdown' && (
        <div className="json-fullscreen" role="dialog" aria-modal="true" aria-label={`${expandedParentNode.title} diagram`}>
          <JsonGraphDiagram
            namePath={[
              ...parents
                .slice(expandedParentTarget.level)
                .reverse()
                .map((parent) => parent.name),
              expandedParentNode.title,
            ]}
            value={expandedParentValue}
            metadata={nestedParentMetadata ?? expandedParentNode.jsonLayout ?? {
              name: expandedParentNode.title,
              viewport: { x: 0, y: 0, k: 1 },
              positions: {},
            }}
            dependentPaths={expandedParentDependentPaths}
            onReferenceSelect={(path) => insertNodeReference({
              id: `${expandedParentNode.id}.${path}`,
              title: `${expandedParentNode.title}.${path}`,
            }, expandedParentTarget.level)}
            onMetadataChange={(metadata) => {
              setNestedParentMetadata(metadata)
              setParents((current) => current.map((parent, index) =>
                index === expandedParentTarget.level
                  ? {
                      ...parent,
                      nodes: parent.nodes.map((node) =>
                        node.id === expandedParentNode.id ? { ...node, jsonLayout: metadata } : node),
                    }
                  : parent))
            }}
            onChange={!nodeExpression(expandedParentNode)
              ? (value) => setParents((current) => current.map((parent, index) =>
                  index === expandedParentTarget.level
                    ? {
                        ...parent,
                        nodes: parent.nodes.map((node) =>
                          node.id === expandedParentNode.id ? { ...node, markdown: value } : node),
                      }
                    : parent))
              : undefined}
            onUp={() => setExpandedParentTarget(null)}
          />
        </div>
      )}
    </main>
  )
}
