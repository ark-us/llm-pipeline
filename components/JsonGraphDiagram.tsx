'use client'

import { useMemo, useState } from 'react'
import { isCsvText } from '@/lib/csv'
import { parsePipelineJson5 } from '@/lib/pipeline-json5'
import { copyText } from '@/lib/clipboard'
import DiagramSurface, {
  DiagramSurfaceNode,
  DiagramTransform,
} from './DiagramSurface'
import MarkdownLiveEditor from './MarkdownLiveEditor'
import CsvSpreadsheet from './CsvSpreadsheet'
import FencedContentView from './FencedContentView'
import { parseFencedContent } from '@/lib/fenced-content'

export type DiagramMetadata = {
  name: string
  viewport: DiagramTransform
  positions: Record<string, { x: number; y: number; width: number; height: number }>
  children?: Record<string, DiagramMetadata>
}

type JsonGraphDiagramProps = {
  namePath: string[]
  value: string
  metadata: DiagramMetadata
  dependentPaths: string[]
  onChange?: (value: string) => void
  onMetadataChange?: (metadata: DiagramMetadata) => void
  onReferenceSelect?: (path: string) => boolean
  onUp: () => void
}

function parseObject(value: string): Record<string, unknown> {
  const parsed = parsePipelineJson5(value)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('diagram JSON must be an object')
  }
  return parsed as Record<string, unknown>
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function safeName(value: string) {
  return value.replace(/[.\s]/g, '')
}

function makeMetadata(name: string, keys: string[]): DiagramMetadata {
  return {
    name,
    viewport: { x: 0, y: 0, k: 1 },
    positions: Object.fromEntries(keys.map((key, index) => [
      key,
      {
        x: 90 + (index % 3) * 420,
        y: 110 + Math.floor(index / 3) * 300,
        width: 360,
        height: 240,
      },
    ])),
    children: {},
  }
}

function stringify(value: unknown) {
  return JSON.stringify(value, null, 2)
}

export default function JsonGraphDiagram({
  namePath,
  value,
  metadata,
  dependentPaths,
  onChange,
  onMetadataChange,
  onReferenceSelect,
  onUp,
}: JsonGraphDiagramProps) {
  const root = useMemo(() => parseObject(value), [value])
  const [path, setPath] = useState<string[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)

  let current: Record<string, unknown> = root
  let currentMetadata = metadata
  for (const segment of path) {
    const child = current[segment]
    if (!isObject(child)) break
    current = child
    currentMetadata = currentMetadata.children?.[segment]
      ?? makeMetadata(segment, Object.keys(child))
  }

  const currentPathNames = [...namePath, ...path]
  const keys = Object.keys(current)
  const positions = currentMetadata.positions
  const nodes: DiagramSurfaceNode[] = keys.map((key, index) => {
    const entry = current[key]
    const position = positions[key] ?? {
      x: 90 + (index % 3) * 420,
      y: 110 + Math.floor(index / 3) * 300,
      width: 360,
      height: 240,
    }
    const fullPath = [...path, key].join('.')
    const referencePath = [...path, key].join('.')
    const fenced = typeof entry === 'string' ? parseFencedContent(entry) : null
    const csv = typeof entry === 'string'
      && (fenced?.kind === 'csv' || isCsvText(entry))
    return {
      id: key,
      title: key,
      ...position,
      linked: dependentPaths.some((dependency) =>
        dependency === fullPath || dependency.startsWith(`${fullPath}.`)),
      canEnter: isObject(entry),
      referencePath,
      content: csv ? (
        <CsvSpreadsheet
          label={`${key} CSV spreadsheet`}
          value={entry}
          onChange={onChange ? (nextValue) => {
            const clone = structuredClone(root)
            let container = clone
            for (const segment of path) container = container[segment] as Record<string, unknown>
            container[key] = nextValue
            onChange(stringify(clone))
          } : undefined}
          onFocus={() => {
            if (!onReferenceSelect?.(referencePath)) setSelectedId(key)
          }}
          pathPrefix={referencePath}
        />
      ) : fenced?.kind === 'mermaid' || fenced?.kind === 'image' ? (
        <FencedContentView
          label={`${key} ${fenced.kind}`}
          value={fenced}
          onChange={onChange ? (nextValue) => {
            const clone = structuredClone(root)
            let container = clone
            for (const segment of path) container = container[segment] as Record<string, unknown>
            container[key] = nextValue
            onChange(stringify(clone))
          } : undefined}
          onFocus={() => {
            if (!onReferenceSelect?.(referencePath)) setSelectedId(key)
          }}
        />
      ) : (
        <MarkdownLiveEditor
          label={`Edit ${key} JSON value`}
          value={typeof entry === 'string' ? entry : stringify(entry)}
          onChange={(nextValue) => {
            if (!onChange) return
            const clone = structuredClone(root)
            let container = clone
            for (const segment of path) container = container[segment] as Record<string, unknown>
            try {
              container[key] = parsePipelineJson5(nextValue)
            } catch {
              container[key] = nextValue
            }
            onChange(stringify(clone))
          }}
          onFocus={() => {
            if (!onReferenceSelect?.(referencePath)) setSelectedId(key)
          }}
          readOnly={!onChange}
          mode={isObject(entry) || Array.isArray(entry) ? 'json' : 'markdown'}
          onShowDiagram={isObject(entry) ? () => setPath((currentPath) => [...currentPath, key]) : undefined}
        />
      ),
    }
  })

  function updateMetadata(next: DiagramMetadata) {
    if (path.length === 0) {
      onMetadataChange?.(next)
      return
    }
    const rootMetadata = structuredClone(metadata)
    let cursor = rootMetadata
    path.forEach((segment, index) => {
      cursor.children ??= {}
      if (index === path.length - 1) {
        cursor.children[segment] = next
      } else {
        cursor.children[segment] ??= makeMetadata(segment, [])
        cursor = cursor.children[segment]
      }
    })
    onMetadataChange?.(rootMetadata)
  }

  function updateCurrent(mutator: (container: Record<string, unknown>) => void) {
    if (!onChange) return
    const clone = structuredClone(root)
    let container = clone
    for (const segment of path) container = container[segment] as Record<string, unknown>
    mutator(container)
    onChange(stringify(clone))
  }

  return (
    <DiagramSurface
      ariaLabel={`${currentPathNames.join('.')} diagram`}
      namePath={currentPathNames}
      nodes={nodes}
      edges={[]}
      selectedId={selectedId}
      transform={currentMetadata.viewport}
      onTransform={(viewport) => updateMetadata({ ...currentMetadata, viewport })}
      onSelect={(id) => {
        if (id && onReferenceSelect?.([...path, id].join('.'))) return true
        setSelectedId(id)
      }}
      onReferenceSelect={onReferenceSelect}
      onMove={(id, x, y) => {
        const node = nodes.find((candidate) => candidate.id === id);
        if (!node) return;
        updateMetadata({
          ...currentMetadata,
          positions: {
            ...currentMetadata.positions,
            [id]: { x, y, width: node.width, height: node.height },
          },
        });
      }}
      onResize={(id, width, height) => {
        const node = nodes.find((candidate) => candidate.id === id);
        if (!node) return;
        updateMetadata({
          ...currentMetadata,
          positions: {
            ...currentMetadata.positions,
            [id]: { x: node.x, y: node.y, width, height },
          },
        });
      }}
      onRename={(id, requested) => {
        const title = safeName(requested)
        if (!title || title === id) return
        updateCurrent((container) => {
          const entry = container[id]
          delete container[id]
          container[title] = entry
        })
      }}
      onRenamePath={(index, requested) => {
        if (index < namePath.length || path.length === 0) return
        const localIndex = index - namePath.length
        const oldKey = path[localIndex]
        const title = safeName(requested)
        if (!title || title === oldKey) return
        const parentPath = path.slice(0, localIndex)
        const clone = structuredClone(root)
        let container = clone
        for (const segment of parentPath) container = container[segment] as Record<string, unknown>
        const entry = container[oldKey]
        delete container[oldKey]
        container[title] = entry
        onChange?.(stringify(clone))
        setPath((currentPath) => currentPath.map((segment, i) => i === localIndex ? title : segment))
      }}
      onAdd={() => {
        let name = 'NewNode'
        let suffix = 2
        while (name in current) {
          name = `NewNode${suffix}`
          suffix += 1
        }
        updateCurrent((container) => { container[name] = '' })
        setSelectedId(name)
      }}
      onCopy={() => {
        void copyText(stringify(current))
      }}
      onUp={() => {
        if (path.length > 0) setPath((currentPath) => currentPath.slice(0, -1))
        else onUp()
      }}
      onEnter={(id) => {
        if (isObject(current[id])) setPath((currentPath) => [...currentPath, id])
      }}
    />
  )
}
