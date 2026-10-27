import { lazy, Suspense, useEffect, useRef, useState } from 'react'

// Keep the Markdown parser and its plugins out of the initial desktop bundle.
const Markdown = lazy(() => import('./Markdown').then((module) => ({ default: module.Markdown })))

interface SmoothStreamProps {
  text: string
  isStreaming: boolean
}

const languages = ['en-US', 'de-DE', 'es-ES', 'zh-CN', 'zh-TW', 'ja-JP', 'ko-KR', 'ru-RU', 'fr-FR']
const SegmenterCtor = (Intl as typeof Intl & {
  Segmenter?: new (
    locales?: string | string[],
    options?: { granularity?: 'grapheme' | 'word' | 'sentence' }
  ) => { segment(input: string): Iterable<{ segment: string }> }
}).Segmenter
const segmenter = SegmenterCtor ? new SegmenterCtor(languages, { granularity: 'grapheme' }) : null

function splitGraphemes(input: string): string[] {
  if (!input) return []
  if (!segmenter) return Array.from(input)
  return Array.from(segmenter.segment(input), (part) => part.segment)
}

export function SmoothStream({ text, isStreaming }: SmoothStreamProps) {
  const [displayed, setDisplayed] = useState('')
  const chunkQueueRef = useRef<string[]>([])
  const displayedTextRef = useRef('')
  const previousTextRef = useRef('')
  const rafRef = useRef<number | null>(null)
  const lastUpdateRef = useRef(0)
  const isStreamingRef = useRef(isStreaming)
  const startLoopRef = useRef<() => void>(() => {})

  isStreamingRef.current = isStreaming

  useEffect(() => {
    const nextText = text || ''

    if (!isStreaming) {
      chunkQueueRef.current = []
      previousTextRef.current = nextText
      displayedTextRef.current = nextText
      setDisplayed(nextText)
      return
    }

    if (previousTextRef.current && !nextText.startsWith(previousTextRef.current)) {
      chunkQueueRef.current = []
      previousTextRef.current = ''
      displayedTextRef.current = ''
      setDisplayed('')
    }

    const delta = nextText.substring(previousTextRef.current.length)
    if (delta) chunkQueueRef.current.push(...splitGraphemes(delta))
    previousTextRef.current = nextText

    if (chunkQueueRef.current.length > 0) startLoopRef.current()
  }, [text, isStreaming])

  useEffect(() => {
    const renderLoop = (time: number) => {
      if (time - lastUpdateRef.current < 100) {
        rafRef.current = requestAnimationFrame(renderLoop)
        return
      }

      lastUpdateRef.current = time
      const queued = chunkQueueRef.current
      if (queued.length === 0) {
        rafRef.current = null
        return
      }

      const count = isStreamingRef.current
        ? Math.max(1, Math.floor(queued.length / 5))
        : queued.length
      displayedTextRef.current += queued.splice(0, count).join('')
      setDisplayed(displayedTextRef.current)

      if (queued.length > 0) {
        rafRef.current = requestAnimationFrame(renderLoop)
      } else {
        rafRef.current = null
      }
    }

    startLoopRef.current = () => {
      if (rafRef.current === null && chunkQueueRef.current.length > 0) {
        rafRef.current = requestAnimationFrame(renderLoop)
      }
    }

    if (chunkQueueRef.current.length > 0) startLoopRef.current()

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [])

  const content = isStreaming ? displayed : text
  return (
    <Suspense fallback={<div className="whitespace-pre-wrap break-words">{content}</div>}>
      <Markdown isStreaming={isStreaming}>{content}</Markdown>
    </Suspense>
  )
}
