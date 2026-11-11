import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Terminal, Copy, Check } from 'lucide-react'

interface CodeRunBlockProps {
  code: string
  language: string
}

export function CodeRunBlock({ code, language }: CodeRunBlockProps) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }, [code])

  return (
    <div className="my-3 rounded-xl overflow-hidden border border-[var(--color-border)] bg-[var(--color-surface)]">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 bg-[var(--color-surface-secondary)] border-b border-[var(--color-border)]">
        <div className="flex items-center gap-1.5 text-[11px] font-bold text-[var(--color-text-tertiary)]">
          <Terminal size={12} />
          <span>{t('chat.code.text') || language || 'Code preview'}</span>
        </div>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-[var(--color-text-tertiary)] hover:text-[var(--color-text)] rounded-md hover:bg-[var(--color-border)] transition-colors"
          aria-label={copied ? 'Copied' : 'Copy code'}
          title={copied ? 'Copied' : 'Copy code'}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
        </button>
      </div>

      {/* Code */}
      <pre className="px-4 py-3 text-[13px] font-mono leading-relaxed overflow-x-auto">
        <code>{code}</code>
      </pre>
    </div>
  )
}
