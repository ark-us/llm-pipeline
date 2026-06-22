import { isFencedCsvText, parseCsv } from './csv'
import { parsePipelineJson5 } from './pipeline-json5'

export type LispSequence = {
  kind: 'sequence'
  sequenceType: 'list' | 'vector'
  items: LispValue[]
}

export type LispObject = {
  kind: 'object'
  entries: Record<string, LispValue>
}

export type LispFunction = {
  kind: 'function'
  source: string
}

export type LispCsv = {
  kind: 'csv'
  source: string
  headers: string[]
  rows: LispObject[]
}

export type LispValue =
  | string
  | number
  | boolean
  | null
  | LispSequence
  | LispObject
  | LispFunction
  | LispCsv

type LispSymbol = {
  kind: 'symbol'
  name: string
}

type LispList = {
  kind: 'list'
  items: LispForm[]
}

type LispVector = {
  kind: 'vector'
  items: LispForm[]
}

type LispForm = LispValue | LispSymbol | LispList | LispVector

export type EvaluationResult = {
  value: LispValue
  dependencies: Set<string>
}

export type PromptCall = {
  engine: string
  prompt: string
  dependencies: Set<string>
}

export type PipelineSourceType =
  | 'markdown'
  | 'decimal'
  | 'hexadecimal'
  | 'boolean'
  | 'lisp'
  | 'csv'
  | 'array'
  | 'object'

class Reader {
  private position = 0

  constructor(private readonly tokens: string[]) {}

  next() {
    const token = this.peek()
    this.position += 1
    return token
  }

  peek() {
    return this.tokens[this.position]
  }

  done() {
    return this.position >= this.tokens.length
  }
}

function tokenize(input: string) {
  const regexp = /[\s,]*(~@|[\[\]()]|"(?:\\.|[^\\"])*"?|;.*|[^\s\[\]('"`,;)]*)/g
  const tokens: string[] = []

  while (true) {
    const matches = regexp.exec(input)
    if (!matches) break
    const token = matches[1]
    if (!token) break
    if (!token.startsWith(';')) tokens.push(token)
  }

  return tokens
}

function readForm(reader: Reader): LispForm {
  const token = reader.peek()
  if (!token) throw new Error('unexpected EOF')
  if (token === '(') return readList(reader)
  if (token === '[') return readVector(reader)
  if (token === ')' || token === ']') throw new Error(`unexpected '${token}'`)
  return readAtom(reader.next())
}

function readList(reader: Reader): LispList {
  reader.next()
  const items: LispForm[] = []

  while (reader.peek() !== ')') {
    if (reader.done()) throw new Error("expected ')', got EOF")
    items.push(readForm(reader))
  }
  reader.next()
  return { kind: 'list', items }
}

function readVector(reader: Reader): LispVector {
  reader.next()
  const items: LispForm[] = []

  while (reader.peek() !== ']') {
    if (reader.done()) throw new Error("expected ']', got EOF")
    items.push(readForm(reader))
  }
  reader.next()
  return { kind: 'vector', items }
}

function readAtom(token: string): LispForm {
  if (/^-?\d+(?:\.\d+)?$/.test(token)) return Number(token)
  if (/^"(?:\\.|[^\\"])*"$/.test(token)) {
    return token
      .slice(1, -1)
      .replace(/\\(.)/g, (_, character: string) => {
        if (character === 'n') return '\n'
        if (character === 't') return '\t'
        return character
      })
  }
  if (token.startsWith('"')) throw new Error('unterminated string')
  if (token === 'nil') return null
  if (token === 'true') return true
  if (token === 'false') return false
  return { kind: 'symbol', name: token }
}

function read(input: string) {
  const reader = new Reader(tokenize(input))
  const form = readForm(reader)
  if (!reader.done()) throw new Error(`unexpected token '${reader.peek()}'`)
  return form
}

function isSymbol(value: LispForm): value is LispSymbol {
  return typeof value === 'object' && value !== null && value.kind === 'symbol'
}

function isList(value: LispForm): value is LispList {
  return typeof value === 'object' && value !== null && value.kind === 'list'
}

function isVector(value: LispForm): value is LispVector {
  return typeof value === 'object' && value !== null && value.kind === 'vector'
}

function isSequence(value: LispValue): value is LispSequence {
  return typeof value === 'object' && value !== null && value.kind === 'sequence'
}

function isObject(value: LispValue): value is LispObject {
  return typeof value === 'object' && value !== null && value.kind === 'object'
}

function isFunction(value: LispValue): value is LispFunction {
  return typeof value === 'object' && value !== null && value.kind === 'function'
}

function isCsv(value: LispValue): value is LispCsv {
  return typeof value === 'object' && value !== null && value.kind === 'csv'
}

function asNumber(value: LispValue) {
  if (typeof value !== 'number') throw new Error('expected number')
  return value
}

export function printPipelineValue(value: LispValue): string {
  if (value === null) return ''
  if (isSequence(value)) {
    const [open, close] = value.sequenceType === 'vector' ? ['[', ']'] : ['(', ')']
    return `${open}${value.items.map(printPipelineValue).join(' ')}${close}`
  }
  if (isObject(value)) return JSON.stringify(pipelineValueToJson(value), null, 2)
  if (isFunction(value)) return value.source
  if (isCsv(value)) return value.source
  return String(value)
}

export function isPipelineExpression(source: string) {
  return classifyPipelineSource(source) === 'lisp'
}

export function classifyPipelineSource(source: string): PipelineSourceType {
  const value = source.trim()
  if (value.startsWith('{') && value.endsWith('}')) {
    try {
      const parsed = parsePipelineJson5(value)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return 'object'
    } catch {
      return 'markdown'
    }
  }
  if (value.startsWith('[') && value.endsWith(']')) {
    try {
      if (Array.isArray(parsePipelineJson5(value))) return 'array'
    } catch {
      return 'markdown'
    }
  }
  if (value.startsWith('(') && value.endsWith(')')) return 'lisp'
  if (isFencedCsvText(value)) return 'csv'
  if (value === 'true' || value === 'false') return 'boolean'
  if (/^0x[0-9a-f]+$/i.test(value)) return 'hexadecimal'
  if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value)
    && Number.isFinite(Number(value))) {
    return 'decimal'
  }
  return 'markdown'
}

export function inferPipelineValue(source: string): LispValue {
  const value = source.trim()
  switch (classifyPipelineSource(source)) {
    case 'decimal':
      return Number(value)
    case 'hexadecimal':
      return Number(value)
    case 'boolean':
      return value === 'true'
    case 'array':
    case 'object':
      return fromJsonValue(parsePipelineJson5(value))
    case 'csv':
      return fromCsvValue(source)
    default:
      return source
  }
}

function fromJsonValue(value: unknown): LispValue {
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const type = classifyPipelineSource(value)
    if (type === 'csv') return fromCsvValue(value)
    if (type === 'lisp') return { kind: 'function', source: value.trim() }
    if (type === 'decimal' || type === 'hexadecimal') return Number(value.trim())
    if (type === 'boolean') return value.trim() === 'true'
    return value
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('JSON numbers must be finite')
    return value
  }
  if (Array.isArray(value)) {
    return {
      kind: 'sequence',
      sequenceType: 'vector',
      items: value.map(fromJsonValue),
    }
  }
  if (typeof value === 'object') {
    return {
      kind: 'object',
      entries: Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [key, fromJsonValue(entry)]),
      ),
    }
  }
  throw new Error('unsupported JSON value')
}

function fromCsvValue(source: string): LispCsv {
  const table = parseCsv(source)
  return {
    kind: 'csv',
    source,
    headers: table.headers,
    rows: table.rows.map((row) => ({
      kind: 'object',
      entries: Object.fromEntries(
        table.headers.map((header, index) => [header, fromJsonValue(row[index] ?? '')]),
      ),
    })),
  }
}

export function pipelineValueToJson(value: LispValue): unknown {
  if (isSequence(value)) return value.items.map(pipelineValueToJson)
  if (isObject(value)) {
    return Object.fromEntries(
      Object.entries(value.entries).map(([key, entry]) => [key, pipelineValueToJson(entry)]),
    )
  }
  if (isFunction(value)) return value.source
  if (isCsv(value)) return value.source
  return value
}

export function evaluatePipelineExpression(
  source: string,
  resolveSymbol: (name: string) => LispValue,
): EvaluationResult {
  const dependencies = new Set<string>()

  const evaluate = (form: LispForm): LispValue => {
    if (isSymbol(form)) {
      const [root, ...path] = form.name.split('.')
      dependencies.add(root)
      let value = resolveSymbol(root)
      for (const segment of path) {
        if (isObject(value)) {
          if (!(segment in value.entries)) {
            throw new Error(`'${form.name}' not found`)
          }
          value = value.entries[segment]
          continue
        }
        if (isSequence(value) && /^\d+$/.test(segment)) {
          const entry = value.items[Number(segment)]
          if (entry === undefined) throw new Error(`'${form.name}' not found`)
          value = entry
          continue
        }
        if (isCsv(value) && /^[1-9]\d*$/.test(segment)) {
          const entry = value.rows[Number(segment) - 1]
          if (!entry) throw new Error(`'${form.name}' not found`)
          value = entry
          continue
        }
        throw new Error(`cannot read '${segment}' from '${root}'`)
      }
      return isFunction(value) ? evaluate(read(value.source)) : value
    }
    if (isVector(form)) {
      return {
        kind: 'sequence',
        sequenceType: 'vector',
        items: form.items.map(evaluate),
      }
    }
    if (!isList(form)) return form
    if (form.items.length === 0) {
      return { kind: 'sequence', sequenceType: 'list', items: [] }
    }

    const [head, ...argumentForms] = form.items
    if (!isSymbol(head)) throw new Error('first list item must be a function name')

    if (head.name === 'if') {
      const [condition, thenForm, elseForm = null] = argumentForms
      if (condition === undefined || thenForm === undefined) {
        throw new Error('if expects a condition and result')
      }
      return evaluate(condition) ? evaluate(thenForm) : evaluate(elseForm)
    }

    if (head.name === 'do') {
      let result: LispValue = null
      argumentForms.forEach((form) => {
        result = evaluate(form)
      })
      return result
    }

    const args = argumentForms.map(evaluate)
    switch (head.name) {
      case 'str':
        return args.map(printPipelineValue).join('')
      case 'list':
        return { kind: 'sequence', sequenceType: 'list', items: args }
      case 'vector':
        return { kind: 'sequence', sequenceType: 'vector', items: args }
      case 'concat': {
        const items = args.flatMap((value) => {
          if (!isSequence(value)) {
            throw new Error('concat expected list or vector')
          }
          return value.items
        })
        return { kind: 'sequence', sequenceType: 'list', items }
      }
      case '+':
        return args.reduce<number>((sum, value) => sum + asNumber(value), 0)
      case '-': {
        if (args.length === 0) throw new Error('- expects at least one number')
        const [first, ...rest] = args.map(asNumber)
        return rest.length === 0 ? -first : rest.reduce((result, value) => result - value, first)
      }
      case '*':
        return args.reduce<number>((product, value) => product * asNumber(value), 1)
      case '/': {
        if (args.length < 2) throw new Error('/ expects at least two numbers')
        const [first, ...rest] = args.map(asNumber)
        return rest.reduce((result, value) => result / value, first)
      }
      case '=':
        return args.length < 2 || args.every((value) => value === args[0])
      default:
        throw new Error(`'${head.name}' is not a function`)
    }
  }

  return { value: evaluate(read(source)), dependencies }
}

export function evaluatePromptCall(
  source: string,
  resolveSymbol: (name: string) => LispValue,
): PromptCall | null {
  const match = source.trim().match(/^\(\s*prompt\s+([^\s()[\]{}]+)\s+([\s\S]+)\)$/)
  if (!match) return null
  const [, engine, promptForm] = match
  const result = evaluatePipelineExpression(`(str ${promptForm})`, resolveSymbol)
  return {
    engine,
    prompt: printPipelineValue(result.value),
    dependencies: result.dependencies,
  }
}
