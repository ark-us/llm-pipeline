import { spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'llm-pipeline-pages-'))
const excludedRoots = new Set([
  '.git',
  '.next',
  '.playwright',
  'node_modules',
  'out',
])

function copyProject() {
  cpSync(root, temporaryRoot, {
    recursive: true,
    filter(source) {
      const relative = path.relative(root, source)
      if (!relative) return true
      if (path.basename(source) === '.DS_Store') return false
      const [topLevel] = relative.split(path.sep)
      if (excludedRoots.has(topLevel)) return false
      // GitHub Pages cannot execute the Node/Playwright route handlers.
      if (relative === path.join('app', 'api')
        || relative.startsWith(`${path.join('app', 'api')}${path.sep}`)) {
        return false
      }
      return true
    },
  })
}

try {
  copyProject()
  const nodeModules = path.join(root, 'node_modules')
  if (!existsSync(nodeModules)) {
    throw new Error('node_modules is missing; run npm install before building GitHub Pages')
  }
  symlinkSync(nodeModules, path.join(temporaryRoot, 'node_modules'), 'dir')

  const nextBin = path.join(nodeModules, 'next', 'dist', 'bin', 'next')
  const result = spawnSync(process.execPath, [nextBin, 'build', '--webpack'], {
    cwd: temporaryRoot,
    env: {
      ...process.env,
      GITHUB_PAGES: 'true',
      NEXT_PUBLIC_STATIC_EXPORT: 'true',
    },
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exitCode = result.status ?? 1

  if (result.status === 0) {
    const output = path.join(root, 'out')
    rmSync(output, { recursive: true, force: true })
    cpSync(path.join(temporaryRoot, 'out'), output, { recursive: true })
    writeFileSync(path.join(output, '.nojekyll'), '')
    console.log(`GitHub Pages export written to ${output}`)
  }
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true })
}
