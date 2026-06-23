export type FencedContentKind = 'csv' | 'mermaid' | 'image'

export type FencedContent = {
  kind: FencedContentKind
  content: string
}

export function parseFencedContent(source: string): FencedContent | null {
  const trimmed = source.trim()
  const match = trimmed.match(/^```(csv|mermaid|image)[ \t]*\r?\n([\s\S]*?)\r?\n```$/i)
  if (!match) return null
  return {
    kind: match[1].toLowerCase() as FencedContentKind,
    content: match[2],
  }
}

export function stringifyFencedContent(kind: FencedContentKind, content: string) {
  return `\`\`\`${kind}\n${content}\n\`\`\``
}
