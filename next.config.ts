import type { NextConfig } from 'next'

const githubPages = process.env.GITHUB_PAGES === 'true'
const repositoryName = process.env.GITHUB_REPOSITORY?.split('/')[1] ?? 'llm-pipeline'
const repositorySite = repositoryName.endsWith('.github.io')
const pagesBasePath = process.env.PAGES_BASE_PATH
  ?? (githubPages && !repositorySite ? `/${repositoryName}` : '')

const nextConfig: NextConfig = {
  ...(githubPages ? {
    output: 'export' as const,
    trailingSlash: true,
    basePath: pagesBasePath,
    assetPrefix: pagesBasePath || undefined,
    images: { unoptimized: true },
  } : {}),
  env: {
    NEXT_PUBLIC_STATIC_EXPORT: githubPages ? 'true' : 'false',
  },
}

export default nextConfig
