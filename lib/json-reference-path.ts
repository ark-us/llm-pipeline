import { syntaxTree } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'

function nodeChildren(node: SyntaxNode) {
  const children: SyntaxNode[] = []
  for (let child = node.firstChild; child; child = child.nextSibling) children.push(child)
  return children
}

function decodePathSegment(source: string) {
  const value = source.trim()
  if ((value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("'") && value.endsWith("'"))) {
    try {
      return JSON.parse(value.startsWith("'")
        ? `"${value.slice(1, -1).replace(/"/g, '\\"')}"`
        : value) as string
    } catch {
      return value.slice(1, -1)
    }
  }
  return value
}

export function jsonPathAtPosition(
  state: EditorState,
  position: number,
) {
  const contains = (node: SyntaxNode) =>
    position >= node.from && position < node.to
  const source = state.doc.toString()
  const objectNames = new Set(['Object', 'ObjectExpression', 'Block'])
  const propertyNames = new Set(['Property', 'LabeledStatement'])
  const keyNames = new Set(['PropertyName', 'PropertyDefinition', 'Label'])
  const arrayNames = new Set(['Array', 'ArrayExpression'])
  const punctuation = new Set(['{', '}', '[', ']', ',', ':'])

  const descend = (node: SyntaxNode, path: string[]): string[] | null => {
    const children = nodeChildren(node)
    if (objectNames.has(node.name)) {
      const property = children.find((child) =>
        propertyNames.has(child.name) && contains(child))
      if (!property) return path.length ? path : null
      const propertyChildren = nodeChildren(property)
      const key = propertyChildren.find((child) => keyNames.has(child.name))
      if (!key) return path.length ? path : null
      const nextPath = [...path, decodePathSegment(source.slice(key.from, key.to))]
      const value = [...propertyChildren].reverse().find((child) =>
        child !== key && !punctuation.has(child.name))
      return value && contains(value)
        ? descend(value, nextPath) ?? nextPath
        : nextPath
    }
    if (arrayNames.has(node.name)) {
      const values = children.filter((child) => !punctuation.has(child.name))
      const index = values.findIndex(contains)
      if (index < 0) return path.length ? path : null
      const nextPath = [...path, String(index)]
      return descend(values[index], nextPath) ?? nextPath
    }
    const child = children.find(contains)
    return child ? descend(child, path) : path.length ? path : null
  }

  return descend(syntaxTree(state).topNode, [])
}
