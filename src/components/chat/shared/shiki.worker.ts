import { createHighlighter } from 'shiki'
import type { HighlightRequest, HighlightResponse } from './shikiWorker'

// One highlighter per worker; keep language loading explicit to limit bundle work.
const supportedLanguages = [
  'javascript', 'typescript', 'python', 'css', 'html', 'json', 'bash', 'shell',
  'sql', 'rust', 'go', 'java', 'ruby', 'php', 'c', 'cpp', 'yaml', 'markdown',
  'xml', 'dockerfile', 'graphql', 'plaintext',
]
const highlighterPromise = createHighlighter({
  themes: ['github-dark', 'github-light'],
  langs: supportedLanguages,
})

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

self.addEventListener('message', async (event: MessageEvent<HighlightRequest>) => {
  const { id, code, language, theme } = event.data
  try {
    const highlighter = await highlighterPromise
    const lang = supportedLanguages.includes(language) ? language : 'text'
    const html = highlighter.codeToHtml(code, { lang, theme })
    self.postMessage({ id, html } satisfies HighlightResponse)
  } catch {
    self.postMessage({ id, html: '<pre><code>' + escapeHtml(code) + '</code></pre>' } satisfies HighlightResponse)
  }
})
