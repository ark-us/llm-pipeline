import JSON5 from 'json5'

function expandTripleQuotedStrings(source: string) {
  return source.replace(
    /'''([\s\S]*?)'''|```([\s\S]*?)```/g,
    (_match, singleQuoted: string | undefined, backtickQuoted: string | undefined) => {
      const content = singleQuoted ?? backtickQuoted ?? ''
      return JSON.stringify(content.replace(/^\s*\n/, '').replace(/\n\s*$/, ''))
    },
  )
}

export function parsePipelineJson5(source: string): unknown {
  try {
    return JSON5.parse(source)
  } catch (error) {
    const expanded = expandTripleQuotedStrings(source)
    if (expanded === source) throw error
    return JSON5.parse(expanded)
  }
}
