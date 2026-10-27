import { useRef, useMemo, useState, useEffect, useLayoutEffect, useCallback } from 'react'
import { ArrowDown } from 'lucide-react'
import { useAppStore } from '../../stores'
import { MessageItem } from './MessageItem'
import type { KiloMessage } from '../../types'

const EMPTY_MESSAGES: never[] = []

interface MessageListProps {
  sessionId: string
  onEdit?: (message: KiloMessage) => void
  onDelete?: (message: KiloMessage) => void
}

export function MessageList({ sessionId, onEdit, onDelete }: MessageListProps) {
  const messages = useAppStore((state) => state.sessionMessages[sessionId]) ?? EMPTY_MESSAGES
  const streamingMessage = useAppStore((state) => state.streamingMessage[sessionId])
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [atBottom, setAtBottom] = useState(true)
  const wasAtBottomRef = useRef(true)
  const previousSessionRef = useRef(sessionId)
  const previousMessageCountRef = useRef(0)
  const groupedMessages = useMemo(() => {
    const rawMessages = [...messages]
    if (streamingMessage?.isStreaming && streamingMessage.parts.length > 0) {
      rawMessages.push({
        info: {
          id: streamingMessage.messageID,
          sessionID: sessionId,
          role: 'assistant' as const,
          time: { created: 0 },
        },
        parts: streamingMessage.parts,
      })
    }

    if (rawMessages.length === 0) return []

    // Merge consecutive assistant messages into one visual bubble.
    const result: KiloMessage[] = []
    for (const msg of rawMessages) {
      const last = result[result.length - 1]
      if (last && last.info.role === 'assistant' && msg.info.role === 'assistant') {
        result[result.length - 1] = {
          ...last,
          parts: [...last.parts, ...msg.parts],
          // Keep the first assistant message ID as the visual bubble's key.
          // Otherwise the key changes when streaming begins and again when it commits,
          // forcing React to unmount/remount the entire message subtree.
          info: {
            ...msg.info,
            id: last.info.id,
            sessionID: last.info.sessionID,
            role: last.info.role,
            time: last.info.time,
          },
        }
      } else {
        result.push(msg)
      }
    }
    return result
  }, [messages, streamingMessage, sessionId])

  const updateBottomState = useCallback(() => {
    const element = scrollRef.current
    if (!element) return
    const isAtBottom = element.scrollHeight - element.scrollTop - element.clientHeight <= 48
    wasAtBottomRef.current = isAtBottom
    setAtBottom(isAtBottom)
  }, [])

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const element = scrollRef.current
    if (!element) return
    element.scrollTo({ top: element.scrollHeight, behavior })
  }, [])

  // A native scroll container avoids virtual-list measurement/anchoring conflicts
  // when streamed markdown, code blocks, and tool output change message heights.
  useLayoutEffect(() => {
    const element = scrollRef.current
    if (!element) return

    if (previousSessionRef.current !== sessionId) {
      previousSessionRef.current = sessionId
      previousMessageCountRef.current = groupedMessages.length
      wasAtBottomRef.current = true
      element.scrollTop = element.scrollHeight
      setAtBottom(true)
      return
    }

    const previousCount = previousMessageCountRef.current
    previousMessageCountRef.current = groupedMessages.length
    const last = groupedMessages[groupedMessages.length - 1]
    if (groupedMessages.length > previousCount && last?.info.role === 'user') {
      wasAtBottomRef.current = true
      element.scrollTop = element.scrollHeight
      setAtBottom(true)
    } else if (wasAtBottomRef.current) {
      // Keep following output only if the user was already at the bottom.
      element.scrollTop = element.scrollHeight
      setAtBottom(true)
    } else {
      updateBottomState()
    }
  }, [sessionId, groupedMessages, updateBottomState])

  // Markdown/code blocks can grow after their first render (e.g. syntax
  // highlighting or images). Follow those height changes only while pinned.
  useEffect(() => {
    const content = contentRef.current
    if (!content || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      const element = scrollRef.current
      if (!element || !wasAtBottomRef.current) return
      element.scrollTop = element.scrollHeight
      setAtBottom(true)
    })
    observer.observe(content)
    return () => observer.disconnect()
  }, [sessionId])

  if (groupedMessages.length === 0) {
    return null
  }

  return (
    <div className="relative flex-1 min-h-0 overflow-hidden pt-2">
      <div
        ref={scrollRef}
        onScroll={updateBottomState}
        className="h-full w-full overflow-y-auto overscroll-contain chat-scroll-area"
        role="log"
        aria-label="Conversation messages"
        aria-live={streamingMessage?.isStreaming ? 'off' : 'polite'}
      >
        <div ref={contentRef} className="px-2 sm:px-3">
          {groupedMessages.map((message, index) => {
            const isStreaming =
              !!streamingMessage?.isStreaming &&
              index === groupedMessages.length - 1 &&
              message.info.role === 'assistant'

            return (
              <MessageItem
                key={message.info.id}
                message={message}
                isStreaming={isStreaming}
                onEdit={onEdit}
                onDelete={onDelete}
              />
            )
          })}
          <div aria-hidden="true" className="h-2" />
        </div>
      </div>
      {!atBottom && (
        <button
          type="button"
          onClick={() => scrollToBottom('smooth')}
          aria-label="Scroll to bottom"
          title="Scroll to bottom"
          className="absolute bottom-5 left-1/2 z-20 -translate-x-1/2 rounded-full border border-border bg-surface px-3 py-2 shadow-lg transition-all hover:bg-surface-secondary"
        >
          <ArrowDown size={16} />
        </button>
      )}
    </div>
  )
}
