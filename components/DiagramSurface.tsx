'use client'

import {
  PointerEvent as ReactPointerEvent,
  ReactNode,
  useEffect,
  useRef,
} from 'react'

export type DiagramTransform = {
  x: number
  y: number
  k: number
}

export type DiagramSurfaceNode = {
  id: string
  title: string
  x: number
  y: number
  width: number
  height: number
  linked?: boolean
  content: ReactNode
  canEnter?: boolean
  referencePath?: string
}

export type DiagramSurfaceEdge = {
  id: string
  source: string
  target: string
  portal?: boolean
  portalPathIndex?: number
}

type DiagramSurfaceProps = {
  ariaLabel: string
  namePath: string[]
  nodes: DiagramSurfaceNode[]
  edges: DiagramSurfaceEdge[]
  selectedId: string | null
  transform: DiagramTransform
  onTransform: (transform: DiagramTransform) => void
  onSelect: (id: string | null) => boolean | void
  onMove: (id: string, x: number, y: number) => void
  onResize: (id: string, width: number, height: number) => void
  onRename: (id: string, title: string) => void
  onRenamePath: (index: number, title: string) => void
  onAdd: () => void
  onUp: () => void
  onCopy: () => void
  onEnter?: (id: string) => void
  onReferenceSelect?: (path: string) => boolean
}

const MIN_WIDTH = 220
const MIN_HEIGHT = 150

export default function DiagramSurface({
  ariaLabel,
  namePath,
  nodes,
  edges,
  selectedId,
  transform,
  onTransform,
  onSelect,
  onMove,
  onResize,
  onRename,
  onRenamePath,
  onAdd,
  onUp,
  onCopy,
  onEnter,
  onReferenceSelect,
}: DiagramSurfaceProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const panRef = useRef<{
    startX: number
    startY: number
    x: number
    y: number
  } | null>(null)
  const byId = new Map(nodes.map((node) => [node.id, node]))

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    const zoomAt = (clientX: number, clientY: number, scale: number) => {
      const bounds = viewport.getBoundingClientRect()
      const point = {
        x: clientX - bounds.left,
        y: clientY - bounds.top,
      }
      const world = {
        x: (point.x - transform.x) / transform.k,
        y: (point.y - transform.y) / transform.k,
      }
      const k = Math.min(2.5, Math.max(0.18, scale))
      onTransform({
        k,
        x: point.x - world.x * k,
        y: point.y - world.y * k,
      })
    }

    const wheel = (event: WheelEvent) => {
      const insideScrollableNode = event.target instanceof Element
        && Boolean(event.target.closest('.node-content'))
      if (!event.ctrlKey && insideScrollableNode) return
      event.preventDefault()
      event.stopPropagation()
      zoomAt(
        event.clientX,
        event.clientY,
        transform.k * Math.exp(-event.deltaY * 0.01),
      )
    }

    let gestureStartScale = transform.k
    const gestureStart = (event: Event) => {
      event.preventDefault()
      event.stopPropagation()
      gestureStartScale = transform.k
    }
    const gestureChange = (event: Event) => {
      const gesture = event as Event & { clientX?: number; clientY?: number; scale?: number }
      event.preventDefault()
      event.stopPropagation()
      const bounds = viewport.getBoundingClientRect()
      zoomAt(
        gesture.clientX ?? bounds.left + bounds.width / 2,
        gesture.clientY ?? bounds.top + bounds.height / 2,
        gestureStartScale * (gesture.scale ?? 1),
      )
    }

    viewport.addEventListener('wheel', wheel, { capture: true, passive: false })
    viewport.addEventListener('gesturestart', gestureStart, { capture: true, passive: false })
    viewport.addEventListener('gesturechange', gestureChange, { capture: true, passive: false })
    return () => {
      viewport.removeEventListener('wheel', wheel, { capture: true })
      viewport.removeEventListener('gesturestart', gestureStart, { capture: true })
      viewport.removeEventListener('gesturechange', gestureChange, { capture: true })
    }
  }, [onTransform, transform])

  function startPan(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || event.target !== event.currentTarget) return
    panRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      x: transform.x,
      y: transform.y,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    onSelect(null)
  }

  function movePan(event: ReactPointerEvent<HTMLDivElement>) {
    if (!panRef.current) return
    onTransform({
      ...transform,
      x: panRef.current.x + event.clientX - panRef.current.startX,
      y: panRef.current.y + event.clientY - panRef.current.startY,
    })
  }

  return (
    <section className="recursive-diagram" aria-label={ariaLabel}>
      <div
        ref={viewportRef}
        className="recursive-diagram-viewport"
        onPointerDown={startPan}
        onPointerMove={movePan}
        onPointerUp={() => { panRef.current = null }}
        onPointerCancel={() => { panRef.current = null }}
      >
        <div className="recursive-grid" />
        <svg className="recursive-edges" aria-hidden="true">
          <g transform={`translate(${transform.x} ${transform.y}) scale(${transform.k})`}>
            {edges.filter((edge) => edge.portalPathIndex === undefined).map((edge) => {
              const source = byId.get(edge.source)
              const target = byId.get(edge.target)
              if (!source || !target) return null
              const sourceCenterX = source.x + source.width / 2
              const sourceCenterY = source.y + source.height / 2
              const targetCenterX = target.x + target.width / 2
              const targetCenterY = target.y + target.height / 2
              const horizontal = Math.abs(targetCenterX - sourceCenterX)
                >= Math.abs(targetCenterY - sourceCenterY)
              const startX = horizontal
                ? targetCenterX >= sourceCenterX ? source.x + source.width : source.x
                : sourceCenterX
              const startY = horizontal
                ? sourceCenterY
                : targetCenterY >= sourceCenterY ? source.y + source.height : source.y
              const endX = horizontal
                ? targetCenterX >= sourceCenterX ? target.x : target.x + target.width
                : targetCenterX
              const endY = horizontal
                ? targetCenterY
                : targetCenterY >= sourceCenterY ? target.y : target.y + target.height
              const midpoint = horizontal
                ? (startX + endX) / 2
                : (startY + endY) / 2
              const path = horizontal
                ? `M${startX},${startY} C${midpoint},${startY} ${midpoint},${endY} ${endX},${endY}`
                : `M${startX},${startY} C${startX},${midpoint} ${endX},${midpoint} ${endX},${endY}`
              return (
                <path
                  key={edge.id}
                  className={edge.portal ? 'is-portal-edge' : undefined}
                  d={path}
                />
              )
            })}
          </g>
          {edges.filter((edge) => edge.portalPathIndex !== undefined).map((edge) => {
            const source = byId.get(edge.source)
            if (!source) return null
            const startX = transform.x + (source.x + source.width / 2) * transform.k
            const startY = transform.y + source.y * transform.k
            const endX = 146 + (edge.portalPathIndex ?? 0) * 155
            const endY = 48
            const midpointY = (startY + endY) / 2
            return (
              <path
                key={edge.id}
                className="is-portal-edge"
                d={`M${startX},${startY} C${startX},${midpointY} ${endX},${midpointY} ${endX},${endY}`}
              />
            )
          })}
        </svg>
        <div
          className="recursive-node-layer"
          style={{ transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.k})` }}
        >
          {nodes.map((node) => (
            <article
              key={node.id}
              data-reference-path={node.referencePath}
              className={`recursive-node ${selectedId === node.id ? 'is-selected' : ''} ${node.linked ? 'is-cross-level-linked' : ''}`}
              style={{
                left: node.x,
                top: node.y,
                width: node.width,
                height: node.height,
              }}
              onPointerDownCapture={(event) => {
                if (event.target instanceof Element
                  && event.target.closest('[data-diagram-entry]')) {
                  return
                }
                const referenceTarget = event.target instanceof Element
                  ? event.target.closest<HTMLElement>('[data-reference-path]')
                  : null
                const referencePath = referenceTarget?.dataset.referencePath
                if (referencePath && onReferenceSelect?.(referencePath)) {
                  event.preventDefault()
                  event.stopPropagation()
                  return
                }
                if (node.referencePath && onReferenceSelect?.(node.referencePath)) {
                  event.preventDefault()
                  event.stopPropagation()
                  return
                }
                if (onSelect(node.id)) {
                  event.preventDefault()
                  event.stopPropagation()
                }
              }}
              onPointerDown={(event) => {
                event.stopPropagation()
                onSelect(node.id)
              }}
              onDoubleClick={() => {
                if (node.canEnter) onEnter?.(node.id)
              }}
            >
              <div
                className="node-drag-handle"
                aria-label={`Drag ${node.title}`}
                onPointerDown={(event) => {
                  if (event.button !== 0) return
                  event.preventDefault()
                  event.stopPropagation()
                  if (onSelect(node.id)) return
                  const origin = {
                    x: event.clientX,
                    y: event.clientY,
                    nodeX: node.x,
                    nodeY: node.y,
                  }
                  const move = (moveEvent: PointerEvent) => {
                    onMove(
                      node.id,
                      origin.nodeX + (moveEvent.clientX - origin.x) / transform.k,
                      origin.nodeY + (moveEvent.clientY - origin.y) / transform.k,
                    )
                  }
                  const up = () => {
                    window.removeEventListener('pointermove', move)
                    window.removeEventListener('pointerup', up)
                  }
                  window.addEventListener('pointermove', move)
                  window.addEventListener('pointerup', up, { once: true })
                }}
              />
              <input
                className="node-title-input"
                value={node.title}
                onChange={(event) => {
                  onSelect(node.id)
                  onRename(node.id, event.target.value)
                }}
                onPointerDown={(event) => {
                  if (onSelect(node.id)) event.preventDefault()
                  event.stopPropagation()
                }}
                onFocus={() => onSelect(node.id)}
                aria-label={`Edit ${node.title} title`}
                spellCheck={false}
              />
              <div className="node-content">{node.content}</div>
              <button
                type="button"
                className="node-resize-handle"
                aria-label={`Resize ${node.title}`}
                onPointerDown={(event) => {
                  if (event.button !== 0) return
                  event.preventDefault()
                  event.stopPropagation()
                  const origin = {
                    x: event.clientX,
                    y: event.clientY,
                    width: node.width,
                    height: node.height,
                  }
                  const move = (moveEvent: PointerEvent) => {
                    onResize(
                      node.id,
                      Math.max(MIN_WIDTH, origin.width + (moveEvent.clientX - origin.x) / transform.k),
                      Math.max(MIN_HEIGHT, origin.height + (moveEvent.clientY - origin.y) / transform.k),
                    )
                  }
                  const up = () => {
                    window.removeEventListener('pointermove', move)
                    window.removeEventListener('pointerup', up)
                  }
                  window.addEventListener('pointermove', move)
                  window.addEventListener('pointerup', up, { once: true })
                }}
              />
            </article>
          ))}
        </div>
      </div>
      <div className="recursive-toolbar">
        <button type="button" className="icon-toolbar-button" onClick={onAdd} aria-label="Add node" title="Add node">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="4" y="5" width="16" height="14" rx="3" />
            <path d="M12 9v6M9 12h6" />
          </svg>
        </button>
        <button type="button" className="icon-toolbar-button" onClick={onUp} aria-label="Move diagram up" title="Move diagram up">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 11.5 12 5l7 6.5M12 5v14" />
          </svg>
        </button>
        <button
          type="button"
          className="icon-toolbar-button"
          onClick={onCopy}
          aria-label="Copy diagram JSON"
          title="Copy diagram JSON without layout"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="8" y="8" width="11" height="11" rx="2" />
            <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
          </svg>
        </button>
        <div className="diagram-breadcrumb">
          {namePath.map((name, index) => (
            <span className="breadcrumb-segment" key={`${index}-${name}`}>
              {index > 0 && <b>.</b>}
              <input
                value={name}
                onChange={(event) => onRenamePath(index, event.target.value)}
                aria-label={index === namePath.length - 1 ? 'Diagram name' : `Parent diagram ${index + 1} name`}
              />
            </span>
          ))}
        </div>
        <span className="zoom-readout">{Math.round(transform.k * 100)}%</span>
      </div>
    </section>
  )
}
