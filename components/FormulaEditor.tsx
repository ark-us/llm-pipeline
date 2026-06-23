'use client'

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react'
import { basicSetup } from 'codemirror'
import {
  foldGutter,
  foldService,
  HighlightStyle,
  StreamLanguage,
  syntaxHighlighting,
} from '@codemirror/language'
import { Compartment, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { tags } from '@lezer/highlight'

export type FormulaEditorHandle = {
  focus: () => void
  isFocused: () => boolean
  getValue: () => string
  getSelection: () => { start: number; end: number }
  setSelection: (start: number, end?: number) => void
}

type FormulaEditorProps = {
  label: string
  value: string
  onChange: (value: string) => void
  onFocus: () => void
  onBlur: () => void
  onSelectionChange: (selection: { start: number; end: number }) => void
}

const lispLanguage = StreamLanguage.define({
  token(stream) {
    if (stream.eatSpace()) return null
    if (stream.match(';')) {
      stream.skipToEnd()
      return 'comment'
    }
    if (stream.match(/"(?:\\.|[^"\\])*"?/)) return 'string'
    if (stream.match(/[-+]?(?:0x[\da-f]+|\d+(?:\.\d*)?|\.\d+)/i)) return 'number'
    if (stream.match(/(?:true|false|nil)\b/)) return 'bool'
    if (stream.match(/[()[\]{}]/)) return 'bracket'
    if (stream.match(/(?:if|do|str|list|vector|concat)\b/)) return 'keyword'
    if (stream.match(/[+\-*/=]/)) return 'keyword'
    stream.match(/[^\s()[\]{}";]+/)
    return 'variableName'
  },
})

const parenthesisFolding = foldService.of((state, lineStart, lineEnd) => {
  const text = state.doc.toString()
  let open = -1
  let quoted = false
  let escaped = false
  for (let index = lineStart; index < lineEnd; index += 1) {
    const character = text[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (character === '\\' && quoted) {
      escaped = true
      continue
    }
    if (character === '"') quoted = !quoted
    if (!quoted && character === ';') break
    if (!quoted && character === '(') {
      open = index
      break
    }
  }
  if (open < 0) return null

  let depth = 0
  quoted = false
  escaped = false
  for (let index = open; index < text.length; index += 1) {
    const character = text[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (character === '\\' && quoted) {
      escaped = true
      continue
    }
    if (character === '"') quoted = !quoted
    if (!quoted && character === ';') {
      const newline = text.indexOf('\n', index)
      if (newline < 0) break
      index = newline
      continue
    }
    if (quoted) continue
    if (character === '(') depth += 1
    if (character === ')') {
      depth -= 1
      if (depth === 0 && index > lineEnd) return { from: lineEnd, to: index }
    }
  }
  return null
})

const formulaTheme = EditorView.theme({
  '&': {
    minHeight: '140px',
    maxHeight: '45vh',
    border: '1px solid var(--line)',
    borderRadius: '10px',
    background: 'var(--surface)',
    color: 'var(--ink)',
    fontSize: '13px',
  },
  '&.cm-focused': {
    outline: 'none',
    borderColor: 'var(--accent)',
    boxShadow: '0 0 0 2px color-mix(in srgb, var(--accent) 22%, transparent)',
  },
  '.cm-scroller': {
    minHeight: '140px',
    maxHeight: '45vh',
    overflow: 'auto',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  },
  '.cm-content': { padding: '12px 8px' },
  '.cm-gutters': {
    borderRight: '1px solid var(--line)',
    background: 'var(--surface-soft)',
    color: 'var(--editor-gutter)',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    color: 'var(--editor-gutter)',
  },
  '.cm-activeLineGutter': {
    color: 'var(--ink)',
    backgroundColor: 'color-mix(in srgb, var(--accent) 10%, transparent)',
  },
})

const lispHighlighting = syntaxHighlighting(HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--accent)', fontWeight: '700' },
  { tag: tags.string, color: 'var(--editor-string)' },
  { tag: tags.number, color: 'var(--editor-number)' },
  { tag: tags.bool, color: 'var(--editor-constant)', fontWeight: '700' },
  { tag: tags.comment, color: 'var(--muted)', fontStyle: 'italic' },
  { tag: tags.variableName, color: 'var(--ink)' },
  { tag: tags.bracket, color: 'var(--accent)', fontWeight: '800' },
]))

const FormulaEditor = forwardRef<FormulaEditorHandle, FormulaEditorProps>(
  function FormulaEditor({
    label,
    value,
    onChange,
    onFocus,
    onBlur,
    onSelectionChange,
  }, ref) {
    const hostRef = useRef<HTMLDivElement>(null)
    const viewRef = useRef<EditorView | null>(null)
    const initialValueRef = useRef(value)
    const initialLabelRef = useRef(label)
    const darkModeCompartmentRef = useRef(new Compartment())
    const callbacksRef = useRef({ onChange, onFocus, onBlur, onSelectionChange })

    useEffect(() => {
      callbacksRef.current = { onChange, onFocus, onBlur, onSelectionChange }
    }, [onBlur, onChange, onFocus, onSelectionChange])

    useImperativeHandle(ref, () => ({
      focus: () => viewRef.current?.focus(),
      isFocused: () => {
        const view = viewRef.current
        return Boolean(view && view.dom.contains(document.activeElement))
      },
      getValue: () => viewRef.current?.state.doc.toString() ?? '',
      getSelection: () => {
        const selection = viewRef.current?.state.selection.main
        return { start: selection?.from ?? 0, end: selection?.to ?? 0 }
      },
      setSelection: (start, end = start) => {
        viewRef.current?.dispatch({ selection: { anchor: start, head: end } })
      },
    }), [])

    useEffect(() => {
      if (!hostRef.current) return
      const darkQuery = window.matchMedia('(prefers-color-scheme: dark)')
      const state = EditorState.create({
        doc: initialValueRef.current,
        extensions: [
          basicSetup,
          lispLanguage,
          foldGutter(),
          parenthesisFolding,
          formulaTheme,
          lispHighlighting,
          darkModeCompartmentRef.current.of(EditorView.darkTheme.of(darkQuery.matches)),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({
            'aria-label': initialLabelRef.current,
            spellcheck: 'false',
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              callbacksRef.current.onChange(update.state.doc.toString())
            }
            if (update.selectionSet || update.focusChanged) {
              const selection = update.state.selection.main
              callbacksRef.current.onSelectionChange({
                start: selection.from,
                end: selection.to,
              })
            }
            if (update.focusChanged) {
              if (update.view.hasFocus) callbacksRef.current.onFocus()
              else callbacksRef.current.onBlur()
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
      const current = view.state.doc.toString()
      if (current !== value) {
        view.dispatch({ changes: { from: 0, to: current.length, insert: value } })
      }
    }, [value])

    return <div className="formula-editor" ref={hostRef} />
  },
)

export default FormulaEditor
