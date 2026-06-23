'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { FencedContent, stringifyFencedContent } from '@/lib/fenced-content'

type FencedContentViewProps = {
  label: string
  value: FencedContent
  onChange?: (source: string) => void
  onFocus: () => void
}

function MermaidDiagram({ source }: { source: string }) {
  const id = useId().replace(/:/g, '')
  const hostRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    import('mermaid').then(async ({ default: mermaid }) => {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'default',
      })
      const result = await mermaid.render(`mermaid-${id}`, source)
      if (!cancelled && hostRef.current) {
        hostRef.current.innerHTML = result.svg
        setError('')
      }
    }).catch((reason) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason))
    })
    return () => { cancelled = true }
  }, [id, source])

  return error
    ? <pre className="fenced-content-error">{error}</pre>
    : <div ref={hostRef} className="mermaid-diagram" />
}

export default function FencedContentView({
  label,
  value,
  onChange,
  onFocus,
}: FencedContentViewProps) {
  const [showSource, setShowSource] = useState(false)

  return (
    <div className="fenced-content-view" aria-label={label} onFocus={onFocus}>
      {showSource ? (
        <textarea
          aria-label={`${label} source`}
          value={value.content}
          readOnly={!onChange}
          onFocus={onFocus}
          onChange={(event) => onChange?.(
            stringifyFencedContent(value.kind, event.target.value),
          )}
        />
      ) : value.kind === 'mermaid' ? (
        <MermaidDiagram source={value.content} />
      ) : /^data:image\/[a-z0-9.+-]+;base64,/i.test(value.content.trim()) ? (
        // The source is an explicit user-provided data URL, so Next image optimization is not applicable.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={value.content.trim()} alt="" />
      ) : (
        <pre className="fenced-content-error">
          Image content must be a base64 data:image URL.
        </pre>
      )}
      {onChange && (
        <button
          type="button"
          className="fenced-source-toggle"
          onClick={() => setShowSource((current) => !current)}
        >
          {showSource ? 'Preview' : 'Source'}
        </button>
      )}
    </div>
  )
}
