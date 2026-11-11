import { createHighlighter, type BundledLanguage } from 'shiki'
import type { HighlightRequest, HighlightResponse } from './shikiWorker'

// One highlighter per worker; keep language loading explicit to limit bundle work.
const supportedLanguages = [
  'javascript', 'typescript', 'python', 'css', 'html', 'json', 'bash', 'shell',
  'sql', 'rust', 'go', 'java', 'ruby', 'php', 'c', 'cpp', 'yaml', 'markdown',
  'xml', 'dockerfile', 'graphql', 'plaintext',
] as const
const highlighterPromise = createHighlighter({
  themes: ['github-dark', 'github-light'],
  langs: [...supportedLanguages],
})

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

self.addEventListener('message', async (rawEvent) => {
  const event = rawEvent as MessageEvent<HighlightRequest>
  const { id, code, language, theme } = event.data
  try {
    const highlighter = await highlighterPromise
    const lang: BundledLanguage = supportedLanguages.includes(language as (typeof supportedLanguages)[number])
      ? language as BundledLanguage
      : 'plaintext' as BundledLanguage
    const html = highlighter.codeToHtml(code, { lang, theme })
    self.postMessage({ id, html } satisfies HighlightResponse)
  } catch {
    self.postMessage({ id, html: '<pre><code>' + escapeHtml(code) + '</code></pre>' } satisfies HighlightResponse)
  }
})
