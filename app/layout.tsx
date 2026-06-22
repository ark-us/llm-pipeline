import type { Metadata } from 'next'
import '@fontsource-variable/roboto-condensed'
import './globals.css'

export const metadata: Metadata = {
  title: 'LLM Pipeline',
  description: 'A visual Markdown pipeline editor',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>{children}</body>
    </html>
  )
}
