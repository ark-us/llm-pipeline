'use client'

import { useEffect, useRef } from 'react'
import { basicSetup } from 'codemirror'
import { javascript } from '@codemirror/lang-javascript'
import { json, jsonParseLinter } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import {
  HighlightStyle,
  syntaxHighlighting,
  syntaxTree,
} from '@codemirror/language'
import { linter } from '@codemirror/lint'
import { Compartment, EditorState, Extension } from '@codemirror/state'
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  keymap,
} from '@codemirror/view'
import { defaultKeymap, historyKeymap } from '@codemirror/commands'
import { tags } from '@lezer/highlight'
import { parsePipelineJson5 } from '@/lib/pipeline-json5'
import { jsonPathAtPosition } from '@/lib/json-reference-path'

type EditorMode = 'markdown' | 'json' | 'json5'

type MarkdownLiveEditorProps = {
  label: string
  value: string
  onChange: (value: string) => void
  onFocus: () => void
  readOnly?: boolean
  mode?: EditorMode
  onShowDiagram?: () => void
  onClear?: () => void
  referencePathPrefix?: string
  onReferenceSelect?: (path: string) => boolean
}

function buildMarkdownDecorations(view: EditorView) {
  const decorations: { from: number; to: number; value: Decoration }[] = []

  for (const range of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from: range.from,
      to: range.to,
      enter(node) {
        const { name } = node.type
        const lineClass =
          name === 'ATXHeading1' ? 'cm-md-heading cm-md-h1'
            : name === 'ATXHeading2' ? 'cm-md-heading cm-md-h2'
              : name === 'ATXHeading3' ? 'cm-md-heading cm-md-h3'
                : name === 'Blockquote' ? 'cm-md-quote'
                  : name === 'FencedCode' ? 'cm-md-code-block'
                    : null

        if (lineClass) {
          const firstLine = view.state.doc.lineAt(node.from)
          const lastLine = view.state.doc.lineAt(node.to)
          for (let number = firstLine.number; number <= lastLine.number; number += 1) {
            const line = view.state.doc.line(number)
            decorations.push({
              from: line.from,
              to: line.from,
              value: Decoration.line({ class: lineClass }),
            })
          }
        }

        const markClass =
          name === 'StrongEmphasis' ? 'cm-md-strong'
            : name === 'Emphasis' ? 'cm-md-emphasis'
              : name === 'InlineCode' ? 'cm-md-inline-code'
                : name === 'Link' || name === 'URL' ? 'cm-md-link'
                  : name === 'Strikethrough' ? 'cm-md-strike'
                    : name === 'ListMark' ? 'cm-md-list-mark'
                      : null

        if (markClass && node.from < node.to) {
          decorations.push({
            from: node.from,
            to: node.to,
            value: Decoration.mark({ class: markClass }),
          })
        }
      },
    })
  }

  return Decoration.set(
    decorations
      .sort((a, b) => a.from - b.from || a.to - b.to)
      .map(({ from, to, value }) => value.range(from, to)),
    true,
  )
}

const markdownEffects = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = buildMarkdownDecorations(view)
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildMarkdownDecorations(update.view)
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
)

const liveEditorTheme = EditorView.theme({
  '&': {
    width: '100%',
    height: '100%',
    backgroundColor: 'transparent',
    color: 'var(--ink)',
    fontSize: '14px',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    overflowX: 'hidden',
    overflowY: 'auto',
    overscrollBehavior: 'contain',
    fontFamily: '"Roboto Condensed Variable", "Roboto Condensed", sans-serif',
    lineHeight: '1.55',
  },
  '.cm-content': {
    minWidth: '0',
    padding: '17px 20px 26px',
    caretColor: 'var(--accent)',
    overflowWrap: 'anywhere',
  },
  '.cm-line': {
    padding: '0',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
  '.cm-gutters': {
    display: 'none',
    borderRight: '1px solid var(--line)',
    backgroundColor: 'var(--surface-soft)',
    color: 'var(--editor-gutter)',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    minWidth: '34px',
    padding: '0 8px 0 6px',
    color: 'var(--editor-gutter)',
  },
  '.cm-activeLineGutter': {
    color: 'var(--ink)',
    backgroundColor: 'color-mix(in srgb, var(--accent) 10%, transparent)',
  },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--accent) 6%, transparent)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: 'color-mix(in srgb, var(--accent) 22%, transparent)',
  },
  '.cm-cursor': { borderLeftColor: 'var(--accent)' },
  '.cm-md-heading': {
    fontWeight: '700',
    lineHeight: '1.25',
    color: 'var(--ink)',
  },
  '.cm-md-h1': { fontSize: '1.55em' },
  '.cm-md-h2': { fontSize: '1.3em' },
  '.cm-md-h3': { fontSize: '1.12em' },
  '.cm-md-strong': { fontWeight: '800', color: 'var(--ink)' },
  '.cm-md-emphasis': { fontStyle: 'italic' },
  '.cm-md-strike': { textDecoration: 'line-through', opacity: '0.7' },
  '.cm-md-inline-code': {
    borderRadius: '4px',
    padding: '1px 3px',
    backgroundColor: 'var(--code)',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '0.88em',
  },
  '.cm-md-code-block': {
    backgroundColor: 'var(--code)',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '0.88em',
  },
  '.cm-md-quote': {
    borderLeft: '3px solid var(--accent)',
    paddingLeft: '12px',
    color: 'var(--muted)',
    fontStyle: 'italic',
  },
  '.cm-md-link': {
    color: 'var(--accent)',
    textDecoration: 'underline',
    textUnderlineOffset: '2px',
  },
  '.cm-md-list-mark': { color: 'var(--accent)', fontWeight: '800' },
})

const liveEditorHighlighting = syntaxHighlighting(HighlightStyle.define([
  { tag: tags.propertyName, color: 'var(--editor-property)' },
  { tag: tags.string, color: 'var(--editor-string)' },
  { tag: tags.number, color: 'var(--editor-number)' },
  { tag: [tags.bool, tags.null], color: 'var(--editor-constant)', fontWeight: '700' },
  { tag: tags.keyword, color: 'var(--editor-keyword)', fontWeight: '700' },
  { tag: tags.comment, color: 'var(--muted)', fontStyle: 'italic' },
  { tag: tags.punctuation, color: 'var(--editor-punctuation)' },
  { tag: tags.variableName, color: 'var(--ink)' },
]))

const json5Linter = linter((view) => {
  try {
    parsePipelineJson5(view.state.doc.toString())
    return []
  } catch (error) {
    return [{
      from: 0,
      to: Math.min(1, view.state.doc.length),
      severity: 'error',
      message: error instanceof Error ? error.message : String(error),
    }]
  }
})

function editorModeExtensions(mode: EditorMode): Extension {
  if (mode === 'json') return [json(), linter(jsonParseLinter())]
  if (mode === 'json5') return [javascript(), json5Linter]
  return [markdown(), markdownEffects]
}

function normalizeJson(view: EditorView) {
  try {
    const formatted = JSON.stringify(parsePipelineJson5(view.state.doc.toString()), null, 2)
    if (formatted === view.state.doc.toString()) return
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: formatted },
    })
  } catch {
    // The active JSON/JSON5 linter displays the parse error in the editor.
  }
}

export default function MarkdownLiveEditor({
  label,
  value,
  onChange,
  onFocus,
  readOnly = false,
  mode = 'markdown',
  onShowDiagram,
  onClear,
  referencePathPrefix,
  onReferenceSelect,
}: MarkdownLiveEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const initialValueRef = useRef(value)
  const initialLabelRef = useRef(label)
  const initialReadOnlyRef = useRef(readOnly)
  const initialModeRef = useRef(mode)
  const labelCompartmentRef = useRef(new Compartment())
  const readOnlyCompartmentRef = useRef(new Compartment())
  const modeCompartmentRef = useRef(new Compartment())
  const darkModeCompartmentRef = useRef(new Compartment())
  const modeRef = useRef(mode)
  const readOnlyRef = useRef(readOnly)
  const onChangeRef = useRef(onChange)
  const onFocusRef = useRef(onFocus)
  const referencePathPrefixRef = useRef(referencePathPrefix)
  const onReferenceSelectRef = useRef(onReferenceSelect)

  useEffect(() => {
    onChangeRef.current = onChange
    onFocusRef.current = onFocus
    referencePathPrefixRef.current = referencePathPrefix
    onReferenceSelectRef.current = onReferenceSelect
  }, [onChange, onFocus, onReferenceSelect, referencePathPrefix])

  useEffect(() => {
    if (!hostRef.current) return

    const darkQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const state = EditorState.create({
      doc: initialValueRef.current,
      extensions: [
        basicSetup,
        modeCompartmentRef.current.of(editorModeExtensions(initialModeRef.current)),
        liveEditorTheme,
        liveEditorHighlighting,
        darkModeCompartmentRef.current.of(EditorView.darkTheme.of(darkQuery.matches)),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        EditorView.lineWrapping,
        labelCompartmentRef.current.of(EditorView.contentAttributes.of({
          'aria-label': initialLabelRef.current,
          spellcheck: 'true',
        })),
        readOnlyCompartmentRef.current.of([
          EditorState.readOnly.of(initialReadOnlyRef.current),
          EditorView.editable.of(!initialReadOnlyRef.current),
        ]),
        EditorView.domEventHandlers({
          focus: () => {
            onFocusRef.current()
            return false
          },
          blur: (_event, view) => {
            if (!readOnlyRef.current && modeRef.current !== 'markdown') {
              normalizeJson(view)
            }
            return false
          },
          pointerdown: (event) => {
            if (modeRef.current !== 'markdown'
              && onReferenceSelectRef.current
              && referencePathPrefixRef.current) {
              const clicked = viewRef.current?.posAndSideAtCoords({
                x: event.clientX,
                y: event.clientY,
              })
              const position = clicked
                ? Math.max(0, clicked.pos + (clicked.assoc === -1 ? -1 : 0))
                : null
              const path = position === null
                ? null
                : jsonPathAtPosition(viewRef.current!.state, position)
              if (path?.length && onReferenceSelectRef.current(
                [referencePathPrefixRef.current, ...path].join('.'),
              )) {
                event.preventDefault()
                event.stopPropagation()
                return true
              }
            }
            onFocusRef.current()
            event.stopPropagation()
            return false
          },
          wheel: (event) => {
            if (!event.ctrlKey) event.stopPropagation()
            return false
          },
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString())
          }
        }),
      ],
    })

    const view = new EditorView({ state, parent: hostRef.current })
    viewRef.current = view
    const updateDarkMode = (event: MediaQueryListEvent) => {
      view.dispatch({
        effects: darkModeCompartmentRef.current.reconfigure(
          EditorView.darkTheme.of(event.matches),
        ),
      })
    }
    darkQuery.addEventListener('change', updateDarkMode)
    return () => {
      darkQuery.removeEventListener('change', updateDarkMode)
      view.destroy()
      viewRef.current = null
    }
  }, [])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: labelCompartmentRef.current.reconfigure(EditorView.contentAttributes.of({
        'aria-label': label,
        spellcheck: 'true',
      })),
    })
  }, [label])

  useEffect(() => {
    readOnlyRef.current = readOnly
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: readOnlyCompartmentRef.current.reconfigure([
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
      ]),
    })
  }, [readOnly])

  useEffect(() => {
    modeRef.current = mode
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: modeCompartmentRef.current.reconfigure(editorModeExtensions(mode)),
    })
  }, [mode])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (view.hasFocus) return
    if (current !== value) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: value } })
    }
  }, [value])

  return (
    <div
      className={`markdown-live-editor ${mode === 'json' || mode === 'json5' ? 'cm-json-editor' : ''}`}
      data-json-reference-surface={
        mode !== 'markdown' && onReferenceSelect && referencePathPrefix ? '' : undefined
      }
    >
      <div ref={hostRef} className="editor-host" />
      {(mode === 'json' || mode === 'json5') && (onShowDiagram || (!readOnly && onClear)) && (
        <div className="json-editor-actions">
          {onShowDiagram && (
            <button
              type="button"
              data-diagram-entry
              onClick={onShowDiagram}
              onPointerDown={(event) => {
                event.preventDefault()
                event.stopPropagation()
              }}
              aria-label="Show JSON diagram"
              title="Show JSON diagram"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <rect x="3" y="4" width="7" height="5" rx="1" />
                <rect x="14" y="15" width="7" height="5" rx="1" />
                <rect x="3" y="15" width="7" height="5" rx="1" />
                <path d="M6.5 9v3.5h11V15M6.5 12.5V15" />
              </svg>
            </button>
          )}
          {onClear && !readOnly && (
            <button
              type="button"
              onClick={onClear}
              onPointerDown={(event) => event.stopPropagation()}
              aria-label="Clear JSON"
              title="Clear JSON"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" />
              </svg>
            </button>
          )}
        </div>
      )}
    </div>
  )
}
