import { memo, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { StackBlock, MainTextBlock } from './blocks'
import { MessageActionBar } from './shared/MessageActionBar'
import { shouldUseDocumentLayout } from './shared/markdownLayout'
import { FileChip } from './shared/FileChip'
import { User, Sparkles } from 'lucide-react'
import { OrbitoLogo } from '../ui/OrbitoLogo'

import type { KiloMessage, MessagePart, TextPart } from '../../types'

type BlockType = 'stack' | 'text'

interface MessageBlock {
  type: BlockType
  parts: MessagePart[]
}

interface MessageItemProps {
  message: KiloMessage
  isStreaming?: boolean
  onEdit?: (message: KiloMessage) => void
  onDelete?: (message: KiloMessage) => void
}

export const MessageItem = memo(function MessageItem({ message, isStreaming = false, onEdit, onDelete }: MessageItemProps) {
  const { t } = useTranslation()
  const isUser = message.info.role === 'user'

  const allText = useMemo(
    () => message.parts.filter((p): p is TextPart => p.type === 'text').map((p) => p.text).join('\n'),
    [message.parts],
  )

  const isDocument = !isUser && shouldUseDocumentLayout(allText)

  const isThinking = useMemo(() => {
    if (!isStreaming) return false
    const lastPart = [...message.parts].reverse().find((part) => part.type !== 'step-start' && part.type !== 'step-finish')
    return lastPart?.type !== 'tool' || (lastPart as any)?.state?.status !== 'running'
  }, [isStreaming, message.parts])

  if (isUser) {
    return (
      <div className="flex justify-end py-2 group animate-message-appear">
        <div className="flex flex-row-reverse items-start gap-2.5 max-w-[85%] lg:max-w-[70%]">
          {/* Avatar */}
          <div className="shrink-0 mt-1">
            <div className="w-7 h-7 rounded-lg bg-accent flex items-center justify-center text-white shadow-sm">
              <User size={14} strokeWidth={2.5} />
            </div>
          </div>

          <div className="flex flex-col items-end gap-2 min-w-0">
            <div
              className="user-message-bubble min-w-0 max-w-full px-3.5 py-2 text-[15px] leading-[1.65] [overflow-wrap:anywhere] [word-break:break-word] rounded-2xl rounded-tr-md font-normal"
            >
              {message.parts.map((part, idx) => {
                if (part.type !== 'text') return null
                const segments = parseUserText(part.text)
                return (
                  <div key={part.id || idx} className="user-message-text flex min-w-0 max-w-full flex-wrap items-center gap-x-1.5 gap-y-1 [overflow-wrap:anywhere] [word-break:break-word]">
                    {segments.map((seg, si) =>
                      seg.type === 'chip' ? (
                        <FileChip key={si} name={seg.name} path={seg.path} isFolder={seg.isFolder} onDark />
                      ) : (
                        <span key={si} className="min-w-0 max-w-full whitespace-pre-wrap [overflow-wrap:anywhere] [word-break:break-word]">{seg.text.trim() ? seg.text : null}</span>
                      ),
                    )}
                  </div>
                )
              })}
            </div>
            <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-150">
              <MessageActionBar
                content={allText}
                timestamp={message.info.time.created}
                align="end"
                editable
                deletable
                onEdit={() => onEdit?.(message)}
                onDelete={() => onDelete?.(message)}
              />
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex justify-start py-3 group animate-message-appear">
      <div
        className={`flex gap-3 ${
          isDocument
            ? 'w-full max-w-full'
            : 'max-w-[96%] lg:max-w-[85%]'
        }`}
      >
        {/* Markdown's first paragraph has top margin; align the logo with its first text line. */}
        <div className="shrink-0 mt-3">
          <div className="relative group/bot">
            <OrbitoLogo isWorking={isStreaming} size={27} />
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <div className="space-y-4">
            {message.parts.length === 0 && isStreaming && (
              <div className="flex items-center gap-3 py-2">
                <div className="w-2 h-2 bg-accent/40 rounded-full animate-bounce [animation-delay:-0.3s]" />
                <div className="w-2 h-2 bg-accent/40 rounded-full animate-bounce [animation-delay:-0.15s]" />
                <div className="w-2 h-2 bg-accent/40 rounded-full animate-bounce" />
              </div>
            )}

            <div className="relative">
              <div className="space-y-4">
                {(() => {
                  const blocks = groupPartsIntoBlocks(message.parts)
                  return blocks.map((block, idx) => {
                    switch (block.type) {
                      case 'stack':
                        return <StackBlock key={`stack-${idx}`} parts={block.parts} isStreaming={isStreaming} />
                      case 'text':
                        return <MainTextBlock key={`text-${idx}`} parts={block.parts} isStreaming={isStreaming} isDocument={isDocument} />
                    }
                  })
                })()}
              </div>
            </div>
          </div>

          <div className="mt-2 flex items-center justify-between opacity-0 group-hover:opacity-100 transition-opacity duration-150 px-1">
            <div className="flex items-center gap-6">
              <MessageActionBar
                content={allText}
                timestamp={message.info.time.created}
                align="start"
                speakable
                deletable
                onDelete={() => onDelete?.(message)}
              />
              {!isStreaming && message.info.cost !== undefined && (
                <div className="text-[10px] font-bold text-text-tertiary tracking-[0.1em] uppercase flex items-center gap-3 opacity-50">
                  {message.info.tokens && (
                    <span>{(message.info.tokens.input ?? 0) + (message.info.tokens.output ?? 0)} tokens</span>
                  )}
                  {message.info.cost > 0 && (
                    <span className="text-accent/90">${message.info.cost.toFixed(5)}</span>
                  )}
                </div>
              )}
            </div>
          </div>

          {isThinking && (
            <div className="mt-3 inline-flex items-center gap-3 py-1 text-sm text-text-secondary" role="status" aria-live="polite">
              <Sparkles size={19} className="text-accent animate-spin-slow" />
              <span>Thinking…</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
})

function groupPartsIntoBlocks(parts: MessagePart[]): MessageBlock[] {
  const blocks: MessageBlock[] = []
  let activityBlock: MessageBlock | null = null

  for (const part of parts) {
    if (part.type === 'step-start' || part.type === 'step-finish' || part.type === 'reasoning') continue
    if (part.type !== 'text' && part.type !== 'tool') continue

    if (part.type === 'tool') {
      // All tool calls for one assistant turn belong to one activity card,
      // even when text or hidden reasoning updates occur between tool calls.
      if (!activityBlock) {
        activityBlock = { type: 'stack', parts: [] }
        blocks.push(activityBlock)
      }
      activityBlock.parts.push(part)
      continue
    }

    const lastBlock = blocks[blocks.length - 1]
    if (lastBlock?.type === 'text') {
      lastBlock.parts.push(part)
    } else {
      blocks.push({ type: 'text', parts: [part] })
    }
  }

  return blocks.filter((block) => block.parts.length > 0)
}

// Split user message text into segments: plain text and FileChip components
const FILE_LINK_RE = /\[(File|Folder):\s+(.+?)\]\((.+?)\)/g

interface TextSegment {
  type: 'text'
  text: string
}
interface ChipSegment {
  type: 'chip'
  name: string
  path: string
  isFolder: boolean
}
type Segment = TextSegment | ChipSegment

function parseUserText(text: string): Segment[] {
  const segments: Segment[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  FILE_LINK_RE.lastIndex = 0
  while ((match = FILE_LINK_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', text: text.slice(lastIndex, match.index) })
    }
    segments.push({
      type: 'chip',
      name: match[2].trim(),
      path: match[3],
      isFolder: match[1] === 'Folder',
    })
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length) {
    segments.push({ type: 'text', text: text.slice(lastIndex) })
  }

  return segments
}
