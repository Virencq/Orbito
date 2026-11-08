import { useMemo } from 'react'
import { TextPartView } from '../parts'
import type { MessagePart } from '../../../types'

interface MainTextBlockProps {
  parts: MessagePart[]
  isStreaming: boolean
  isDocument: boolean
}

export function MainTextBlock({ parts, isStreaming, isDocument }: MainTextBlockProps) {
  // Avoid rebuilding combined text on unrelated parent renders.
  const allText = useMemo(() => parts.map(p => ('text' in p ? p.text : '') || '').join('\n'), [parts])

  // Do not render an empty streaming text container; activity feedback lives on the Cowork logo.
  if (!allText.trim()) return null

  if (isDocument) {
    return (
      <div className="relative">
        <div className="transition-all duration-700 group/text-part">
          <TextPartView text={allText} isStreaming={isStreaming} />
          {isStreaming && (
            <div className="absolute -bottom-1 -left-1 w-2 h-2 bg-[var(--color-accent)] rounded-full animate-pulse shadow-[0_0_8px_var(--color-accent)]" />
          )}
        </div>
      </div>
    )
  }

  return (
    <div className={`relative transition-colors duration-200 group/text-part ${
      isStreaming
        ? 'rounded-xl bg-[var(--color-accent-subtle)]/35 px-3 py-2 border border-[var(--color-accent)]/15'
        : 'bg-transparent border border-transparent px-0 py-0'
    }`}>
      <TextPartView text={allText} isStreaming={isStreaming} />
      {isStreaming && (
        <div className="absolute -bottom-1 -left-1 w-2 h-2 bg-[var(--color-accent)] rounded-full animate-pulse shadow-[0_0_8px_var(--color-accent)]" />
      )}
    </div>
  )
}
