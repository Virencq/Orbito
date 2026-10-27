import { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Send, Square, X, File, Folder, Paperclip, FolderPlus, Mic, LoaderCircle, AudioLines, PhoneCall } from 'lucide-react'
import { TextField, TextArea } from "@heroui/react"
import { Button, Card } from '../ui'
import { useChatAttachments } from './useChatAttachments'
import { useSkillStore } from '../../stores/skillStore'
import { JCodeModelControls } from '../settings/JCodeModelControls'
import {
  cancelDictation,
  getDictationLevel,
  getDictationStatus,
  isTauriRuntime,
  openVoiceInputSettings,
  startDictation,
  stopDictation,
  type VoiceInputStatus,
} from '../../utils/voiceInput'
import {
  cancelRealtimeVoice,
  getVoiceRuntimeStatus,
  listenRealtimeVoice,
  listenSpeechPlayback,
  startRealtimeVoice,
  stopRealtimeVoice,
  stopSpeaking,
  voiceAsset,
  type VoiceRuntimeStatus,
} from '../../utils/voiceRuntime'
import {
  getVoiceConversation,
  listenVoiceConversation,
  setVoiceConversation,
  setVoiceConversationState,
  shouldInterruptVoicePlayback,
  type VoiceConversationSnapshot,
} from '../../utils/voiceConversation'

export interface ImageAttachment {
  data: string
  mimeType: string
}

interface ChatInputProps {
  onSubmit: (content: string, images?: ImageAttachment[]) => void
  onAbort?: () => void
  isStreaming?: boolean
  disabled?: boolean
  placeholder?: string
  variant?: 'default' | 'hero'
  draftValue?: string | null
}

export function ChatInput({
  onSubmit,
  onAbort,
  isStreaming = false,
  disabled = false,
  placeholder,
  variant = 'default',
  draftValue = null,
}: ChatInputProps) {
  const { t, i18n } = useTranslation()
  const [input, setInput] = useState('')
  const {
    attachments,
    isDragOver,
    removeAttachment,
    clearAttachments,
    pickFolder,
    pickFiles,
    handleDrop,
    handleDragOver,
    handleDragLeave,
    handlePaste,
  } = useChatAttachments({ disabled, isStreaming })
  const [showAddMenu, setShowAddMenu] = useState(false)
  const [showSkillsMenu, setShowSkillsMenu] = useState(false)
  const [activeSkillSuggestion, setActiveSkillSuggestion] = useState(0)
  // Select the stable store array; filtering inside the selector creates a new
  // snapshot on every read and can trigger React's maximum-update-depth error.
  const allSkills = useSkillStore((state) => state.skills)
  const skills = allSkills.filter((skill) => skill.enabled)
  const slashMatch = input.match(/(?:^|\s)\/([\w-]*)$/)
  const slashQuery = slashMatch?.[1]?.toLowerCase() ?? ''
  const slashSuggestions = slashMatch
    ? skills.filter((skill) => skill.name.toLowerCase().includes(slashQuery)).slice(0, 8)
    : []
  const showSlashSuggestions = !!slashMatch && slashSuggestions.length > 0
  const addMenuRef = useRef<HTMLDivElement>(null)
  const [dictation, setDictation] = useState<VoiceInputStatus | null>(null)
  const [dictationRuntimeAvailable, setDictationRuntimeAvailable] = useState<boolean | null>(null)
  const [dictationBusy, setDictationBusy] = useState(false)
  const [dictationError, setDictationError] = useState<string | null>(null)
  const [levels, setLevels] = useState<number[]>([])
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const [voiceRuntime, setVoiceRuntime] = useState<VoiceRuntimeStatus | null>(null)
  const [voiceRuntimeAvailable, setVoiceRuntimeAvailable] = useState<boolean | null>(null)
  const [realtimeMode, setRealtimeMode] = useState<'dictation' | 'conversation' | null>(null)
  const [realtimePartial, setRealtimePartial] = useState('')
  const [realtimeLevel, setRealtimeLevel] = useState(0)
  const [realtimeBusy, setRealtimeBusy] = useState(false)
  const [conversation, setConversationSnapshot] = useState<VoiceConversationSnapshot>(
    getVoiceConversation(),
  )
  const composingRef = useRef(false)
  const realtimeModeRef = useRef<'dictation' | 'conversation' | null>(null)
  const turnSubmittedRef = useRef(false)
  const isStreamingRef = useRef(isStreaming)
  const realtimeLevelRef = useRef(0)
  const playbackStartedAtRef = useRef(0)
  const acceptVoiceTurnAfterRef = useRef(0)
  const onSubmitRef = useRef(onSubmit)
  onSubmitRef.current = onSubmit

  useEffect(() => {
    if (!showAddMenu) { setShowSkillsMenu(false); return }
    const close = (event: MouseEvent) => {
      if (!addMenuRef.current?.contains(event.target as Node)) setShowAddMenu(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowAddMenu(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [showAddMenu])

  const submitWithAttachments = useCallback(() => {
    if (dictation?.recording || dictationBusy || realtimeMode || realtimeBusy) return
    if (!input.trim() && attachments.length === 0) return

    const parts: string[] = []
    const images: ImageAttachment[] = []

    // File references — rendered as styled chips via Markdown
    for (const att of attachments) {
      // Images with base64 data are sent as multimodal content
      if (att.data && att.mimeType?.startsWith('image/')) {
        images.push({ data: att.data, mimeType: att.mimeType })
      }
      parts.push(`[File: ${att.name}](${att.path || '#'})`)
    }

    const userText = input.trim()
    if (userText) parts.push(userText)

    clearAttachments()

    onSubmit(parts.join('\n'), images.length > 0 ? images : undefined)
    setInput('')
  }, [input, attachments, onSubmit, clearAttachments, dictation?.recording, dictationBusy, realtimeMode, realtimeBusy])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (showSlashSuggestions && !composingRef.current) {
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setActiveSkillSuggestion((index) => (index + 1) % slashSuggestions.length)
          return
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          setActiveSkillSuggestion((index) => (index - 1 + slashSuggestions.length) % slashSuggestions.length)
          return
        }
        if (e.key === 'Escape') {
          setInput((current) => current.replace(/(?:^|\s)\/[\w-]*$/, '').trimEnd())
          setActiveSkillSuggestion(0)
          return
        }
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          const skill = slashSuggestions[activeSkillSuggestion] ?? slashSuggestions[0]
          if (skill) {
            const instruction = `Use the "${skill.name}" skill for this task. `
            setInput((current) => current.replace(/(?:^|\s)\/[\w-]*$/, instruction).trimStart())
            setActiveSkillSuggestion(0)
          }
          return
        }
      }
      if (e.key === 'Enter' && !e.shiftKey && !composingRef.current) {
        e.preventDefault()
        if ((input.trim() || attachments.length > 0) && !isStreaming && !disabled && !dictation?.recording && !dictationBusy && !realtimeMode && !realtimeBusy) {
          submitWithAttachments()
        }
      }
    },
    [input, attachments, isStreaming, disabled, submitWithAttachments, dictation?.recording, dictationBusy, realtimeMode, realtimeBusy, showSlashSuggestions, slashSuggestions, activeSkillSuggestion],
  )

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      submitWithAttachments()
    },
    [submitWithAttachments],
  )

  const handleCompositionStart = useCallback(() => {
    composingRef.current = true
  }, [])

  const handleCompositionEnd = useCallback(() => {
    composingRef.current = false
  }, [])

  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (draftValue !== null && draftValue !== undefined) {
      setInput(draftValue)
      requestAnimationFrame(() => textareaRef.current?.focus())
    }
  }, [draftValue])

  useEffect(() => {
    if (!isTauriRuntime()) return
    const refresh = (event?: Event) => {
      const supplied = (event as CustomEvent<VoiceInputStatus> | undefined)?.detail
      if (supplied) {
        setDictation(supplied)
        setDictationRuntimeAvailable(true)
        return
      }
      void getDictationStatus()
        .then((status) => {
          setDictation(status)
          setDictationRuntimeAvailable(true)
        })
        .catch(() => {
          setDictation(null)
          setDictationRuntimeAvailable(false)
        })
    }
    refresh()
    window.addEventListener('s-loop:voice-input-changed', refresh)
    return () => window.removeEventListener('s-loop:voice-input-changed', refresh)
  }, [])

  useEffect(() => {
    realtimeModeRef.current = realtimeMode
  }, [realtimeMode])

  useEffect(() => {
    isStreamingRef.current = isStreaming
  }, [isStreaming])

  useEffect(() => {
    if (!conversation.active || conversation.state !== 'listening') {
      return
    }
    turnSubmittedRef.current = false
    if (realtimeMode || realtimeBusy || isStreaming) return
    realtimeModeRef.current = 'conversation'
    setRealtimeMode('conversation')
    setRealtimeBusy(true)
    void startRealtimeVoice()
      .then(setVoiceRuntime)
      .catch((reason) => {
        setDictationError(String(reason))
        setVoiceConversation(false, 'error', String(reason))
      })
      .finally(() => setRealtimeBusy(false))
  }, [conversation.active, conversation.state, realtimeMode, realtimeBusy, isStreaming])

  useEffect(() => {
    if (!isTauriRuntime()) return
    let disposed = false
    void getVoiceRuntimeStatus()
      .then((status) => {
        setVoiceRuntime(status)
        setVoiceRuntimeAvailable(true)
      })
      .catch(() => {
        setVoiceRuntime(null)
        setVoiceRuntimeAvailable(false)
      })
    const disposeConversation = listenVoiceConversation(setConversationSnapshot)
    let disposeRealtime: (() => void) | undefined
    let disposePlayback: (() => void) | undefined

    void listenRealtimeVoice((event) => {
      if (disposed) return
      if (event.kind === 'level') {
        const level = event.level ?? 0
        realtimeLevelRef.current = level
        setRealtimeLevel(level)
        return
      }
      if (event.kind === 'speech-start') {
        const current = getVoiceConversation()
        if (shouldInterruptVoicePlayback(
          realtimeModeRef.current,
          current,
          playbackStartedAtRef.current,
          realtimeLevelRef.current,
        )) {
          turnSubmittedRef.current = false
          acceptVoiceTurnAfterRef.current = 0
          setVoiceConversationState('listening')
          void stopSpeaking().catch((reason) => setDictationError(String(reason)))
        }
        return
      }
      if (event.kind === 'partial') {
        const current = getVoiceConversation()
        if (
          realtimeModeRef.current !== 'conversation' ||
          current.state === 'listening'
        ) {
          setRealtimePartial(event.text?.trim() ?? '')
        }
        return
      }
      if (event.kind === 'final') {
        const transcript = event.text?.trim() ?? ''
        setRealtimePartial('')
        if (!transcript) return

        const currentConversation = getVoiceConversation()
        if (
          realtimeModeRef.current === 'conversation' &&
          currentConversation.active &&
          event.turnComplete &&
          !turnSubmittedRef.current &&
          Date.now() >= acceptVoiceTurnAfterRef.current &&
          !isStreamingRef.current
        ) {
          turnSubmittedRef.current = true
          setVoiceConversationState('thinking')
          onSubmitRef.current(transcript)
          return
        }

        if (realtimeModeRef.current === 'dictation') {
          setInput((draft) =>
            draft.trim() ? `${draft.trimEnd()} ${transcript}` : transcript,
          )
        }
        return
      }
      if (event.kind === 'state') {
        if (event.state === 'listening') {
          setRealtimeBusy(false)
          if (getVoiceConversation().active) {
            setVoiceConversationState('listening')
          }
        }
        if (event.state === 'stopped') {
          setRealtimeBusy(false)
          setRealtimeLevel(0)
          setRealtimePartial('')
          if (!getVoiceConversation().active) {
            realtimeModeRef.current = null
            setRealtimeMode(null)
          }
        }
        return
      }
      if (event.kind === 'error') {
        setDictationError(event.message || 'Real-time voice recognition failed.')
        setRealtimeBusy(false)
        realtimeModeRef.current = null
        setRealtimeMode(null)
        setVoiceConversation(false, 'error', event.message || undefined)
      }
    }).then((dispose) => {
      if (disposed) dispose()
      else disposeRealtime = dispose
    })

    void listenSpeechPlayback((event) => {
      if (disposed) return
      const current = getVoiceConversation()
      if (!current.active) return
      if (event.state === 'loading' || event.state === 'speaking') {
        if (current.state !== 'speaking') {
          playbackStartedAtRef.current = Date.now()
        }
        setVoiceConversationState('speaking')
        return
      }
      if (event.state === 'error') {
        setVoiceConversation(false, 'error', event.message || undefined)
        setDictationError(event.message || 'Local speech playback failed.')
        return
      }
      if (event.state === 'idle' && current.state === 'speaking') {
        playbackStartedAtRef.current = 0
        acceptVoiceTurnAfterRef.current = Date.now() + 300
        turnSubmittedRef.current = false
        setVoiceConversationState('listening')
      }
    }).then((dispose) => {
      if (disposed) dispose()
      else disposePlayback = dispose
    })

    return () => {
      disposed = true
      disposeConversation()
      disposeRealtime?.()
      disposePlayback?.()
    }
  }, [])

  useEffect(() => {
    if (!dictation?.recording) {
      setLevels([])
      setRecordingSeconds(0)
      return
    }
    const started = Date.now()
    const timer = window.setInterval(() => {
      setRecordingSeconds(Math.floor((Date.now() - started) / 1000))
      void getDictationLevel()
        .then((level) => setLevels((current) => [...current.slice(-15), level]))
        .catch(() => undefined)
    }, 100)
    return () => window.clearInterval(timer)
  }, [dictation?.recording])

  useEffect(() => {
    if (!dictation?.recording) return
    const cancelOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      void cancelDictation()
        .catch(() => undefined)
        .finally(() => void getDictationStatus().then(setDictation))
    }
    window.addEventListener('keydown', cancelOnEscape)
    return () => window.removeEventListener('keydown', cancelOnEscape)
  }, [dictation?.recording])

  useEffect(() => {
    if (!realtimeMode) return
    const cancelOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setVoiceConversation(false)
      realtimeModeRef.current = null
      setRealtimeMode(null)
      setRealtimePartial('')
      setRealtimeLevel(0)
      void cancelRealtimeVoice().then(setVoiceRuntime).catch(() => undefined)
      void stopSpeaking().catch(() => undefined)
    }
    window.addEventListener('keydown', cancelOnEscape)
    return () => window.removeEventListener('keydown', cancelOnEscape)
  }, [realtimeMode])

  const toggleDictation = async () => {
    if (!isTauriRuntime() || dictationBusy) return
    setDictationError(null)
    try {
      if (dictation?.recording) {
        setDictationBusy(true)
        const transcript = (await stopDictation()).trim()
        if (transcript) {
          setInput((draft) => draft.trim() ? `${draft.trimEnd()} ${transcript}` : transcript)
        }
        setDictation(await getDictationStatus())
        textareaRef.current?.focus()
        return
      }
      const current = dictation || await getDictationStatus()
      if (!current.supported || !current.modelVerified || !current.testPassed) {
        openVoiceInputSettings()
        return
      }
      setDictationBusy(true)
      setDictation(await startDictation())
    } catch (reason) {
      setDictationError(String(reason))
      await getDictationStatus().then(setDictation).catch(() => undefined)
    } finally {
      setDictationBusy(false)
    }
  }

  const realtimeReady =
    !!voiceAsset(voiceRuntime, 'streaming-asr')?.installed &&
    !!voiceAsset(voiceRuntime, 'vad')?.installed
  const conversationReady =
    realtimeReady && !!voiceAsset(voiceRuntime, 'tts')?.installed

  const toggleRealtimeDictation = async () => {
    if (!isTauriRuntime() || realtimeBusy || conversation.active) return
    setDictationError(null)
    setRealtimeBusy(true)
    try {
      if (realtimeMode === 'dictation') {
        await stopRealtimeVoice()
        realtimeModeRef.current = null
        setRealtimeMode(null)
        setRealtimePartial('')
        setRealtimeLevel(0)
        setVoiceRuntime(await getVoiceRuntimeStatus())
        textareaRef.current?.focus()
        return
      }
      const current = voiceRuntime || await getVoiceRuntimeStatus()
      setVoiceRuntime(current)
      if (
        !voiceAsset(current, 'streaming-asr')?.installed ||
        !voiceAsset(current, 'vad')?.installed
      ) {
        openVoiceInputSettings()
        return
      }
      turnSubmittedRef.current = false
      realtimeModeRef.current = 'dictation'
      setRealtimeMode('dictation')
      setVoiceRuntime(await startRealtimeVoice())
    } catch (reason) {
      realtimeModeRef.current = null
      setRealtimeMode(null)
      setDictationError(String(reason))
    } finally {
      setRealtimeBusy(false)
    }
  }

  const toggleConversation = async () => {
    if (!isTauriRuntime() || realtimeBusy) return
    setDictationError(null)

    if (conversation.active) {
      if (conversation.state === 'speaking') {
        await stopSpeaking().catch((reason) => setDictationError(String(reason)))
        return
      }
      setVoiceConversation(false)
      realtimeModeRef.current = null
      setRealtimeMode(null)
      setRealtimePartial('')
      setRealtimeLevel(0)
      await Promise.all([
        cancelRealtimeVoice().catch(() => undefined),
        stopSpeaking().catch(() => undefined),
      ])
      setVoiceRuntime(await getVoiceRuntimeStatus().catch(() => voiceRuntime))
      return
    }

    const current = voiceRuntime || await getVoiceRuntimeStatus()
    setVoiceRuntime(current)
    if (
      !voiceAsset(current, 'streaming-asr')?.installed ||
      !voiceAsset(current, 'vad')?.installed ||
      !voiceAsset(current, 'tts')?.installed
    ) {
      openVoiceInputSettings()
      return
    }

    setRealtimeBusy(true)
    setVoiceConversation(true, 'starting')
    turnSubmittedRef.current = false
    realtimeModeRef.current = 'conversation'
    setRealtimeMode('conversation')
    try {
      setVoiceRuntime(await startRealtimeVoice())
    } catch (reason) {
      realtimeModeRef.current = null
      setRealtimeMode(null)
      setVoiceConversation(false, 'error', String(reason))
      setDictationError(String(reason))
    } finally {
      setRealtimeBusy(false)
    }
  }

  // Auto-resize logic
  // Keep an empty/reopened composer compact. HeroUI can retain the previous
  // textarea height between session changes, so explicitly collapse before
  // measuring new content.
  useLayoutEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return

    const minHeight = variant === 'hero' ? 64 : 52
    const maxHeight = 240
    textarea.style.minHeight = `${minHeight}px`
    textarea.style.maxHeight = `${maxHeight}px`
    textarea.style.height = `${minHeight}px`

    if (!input.trim()) {
      textarea.style.overflowY = 'hidden'
      return
    }

    textarea.style.height = 'auto'
    const measuredHeight = Math.max(minHeight, Math.min(textarea.scrollHeight, maxHeight))
    textarea.style.height = `${measuredHeight}px`
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden'
  }, [input, variant])

  const isHero = variant === 'hero'
  const voiceReady = !!dictation?.supported && !!dictation?.modelVerified && !!dictation?.testPassed
  const recordingTime = `${Math.floor(recordingSeconds / 60)}:${String(recordingSeconds % 60).padStart(2, '0')}`

  return (
    <div
      className={isHero ? "w-full mx-auto px-0 pb-0" : "w-full max-w-(--spacing-chat-max) mx-auto px-5 pb-3"}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      {dictationError && (
        <div role="alert" className="mb-2 rounded-lg border border-red-500/20 bg-red-500/8 px-3 py-2 text-sm text-red-500">
          {dictationError}
        </div>
      )}
      {isTauriRuntime() && dictationRuntimeAvailable === false && voiceRuntimeAvailable === false && (
        <div role="status" className="mb-2 rounded-lg border border-border bg-surface-secondary px-3 py-2 text-xs text-text-tertiary">
          Voice features are unavailable in this build. Text chat remains available.
        </div>
      )}
      <form onSubmit={handleSubmit}>
        <Card
          variant={isHero ? 'glass' : 'default'}
          className={`relative group transition-colors duration-150 border border-border ${
            isHero ? 'shadow-none rounded-[16px] bg-surface p-0 overflow-visible' : 'shadow-sm rounded-xl bg-surface/96 p-1.5'
          } ${isDragOver ? 'ring-2 ring-accent ring-offset-2 ring-offset-bg' : 'focus-ring-accent'}`}
        >
          {isDragOver && (
            <div className="absolute inset-0 z-10 flex items-center justify-center rounded-[inherit] bg-surface/96 pointer-events-none">
              <div className="rounded-lg border border-dashed border-accent/50 bg-accent-subtle px-8 py-5 animate-fade-in">
                <p className="text-sm font-semibold text-accent flex items-center gap-2">
                  <Paperclip size={18} />
                  Drop files here
                </p>
              </div>
            </div>
          )}

          <div className="flex flex-col">
            {showSlashSuggestions && (
              <div role="listbox" aria-label="Skill suggestions" className="absolute bottom-[76px] left-3 z-[90] flex max-h-[min(320px,45vh)] w-[min(360px,calc(100%-24px))] flex-col overflow-y-auto overscroll-contain rounded-xl border border-border bg-surface shadow-xl">
                <div className="sticky top-0 z-10 shrink-0 border-b border-border bg-surface px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">Skills · ↑↓ to navigate · Enter to select</div>
                {slashSuggestions.map((skill, index) => (
                  <button
                    key={skill.name}
                    type="button"
                    role="option"
                    aria-selected={index === activeSkillSuggestion}
                    onMouseEnter={() => setActiveSkillSuggestion(index)}
                    onClick={() => {
                      const instruction = `Use the "${skill.name}" skill for this task. `
                      setInput((current) => current.replace(/(?:^|\s)\/[\w-]*$/, instruction).trimStart())
                      setActiveSkillSuggestion(0)
                      requestAnimationFrame(() => textareaRef.current?.focus())
                    }}
                    className={`flex w-full flex-col px-3 py-2 text-left ${index === activeSkillSuggestion ? 'bg-surface-hover' : 'hover:bg-surface-hover'}`}
                  >
                    <span className="text-[13px] font-medium text-text">/{skill.name}</span>
                    <span className="line-clamp-1 text-[11px] text-text-tertiary">{skill.description}</span>
                  </button>
                ))}
              </div>
            )}
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-2 px-4 pt-3 pb-1 animate-fade-in">
                {attachments.map((att, idx) => (
                  <div
                    key={idx}
                    className="group/att inline-flex items-center gap-2 rounded-lg border border-border bg-surface-secondary/70 pl-3 pr-2 py-2 text-[12px] transition-colors hover:border-accent/50 hover:bg-surface-secondary"
                    title={att.path}
                  >
                    {att.isDir ? <Folder size={14} className="text-accent" /> : <File size={14} className="text-accent" />}
                    <span className="max-w-[180px] truncate text-text-secondary font-bold tracking-tight">{att.name}</span>
                    <button
                      type="button"
                      onClick={() => removeAttachment(idx)}
                      className="inline-flex h-6 w-6 items-center justify-center rounded-md text-text-tertiary hover:bg-red-500/10 hover:text-red-500 transition-all opacity-40 group-hover/att:opacity-100"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {dictation?.recording && (
              <div className="mx-3 mt-3 flex items-center gap-3 rounded-lg border border-red-500/15 bg-red-500/5 px-3 py-2.5 text-red-500">
                <span className="h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse" />
                <span className="text-xs font-bold">Listening · {recordingTime}</span>
                <div className="ml-auto flex h-7 items-center gap-1" aria-label="Microphone input level">
                  {Array.from({ length: 16 }, (_, index) => {
                    const level = levels[levels.length - 16 + index] ?? 0
                    return <span key={index} className="w-1 rounded-full bg-red-500/70" style={{ height: `${4 + level * 22}px` }} />
                  })}
                </div>
                <span className="text-[11px] text-text-tertiary">Esc to cancel</span>
              </div>
            )}

            {realtimeMode && (
              <div className="mx-3 mt-3 rounded-lg border border-accent/15 bg-accent/5 px-3 py-2.5 text-accent">
                <div className="flex items-center gap-3">
                  <span className="h-2.5 w-2.5 rounded-full bg-accent animate-pulse" />
                  <span className="text-xs font-bold">
                    {realtimeMode === 'conversation'
                      ? conversation.state === 'thinking'
                        ? 'Thinking'
                        : conversation.state === 'speaking'
                          ? 'Speaking'
                          : 'Voice call · Listening'
                      : 'Live captions'}
                  </span>
                  <div className="ml-auto flex h-7 items-center gap-1" aria-label="Real-time microphone input level">
                    {Array.from({ length: 16 }, (_, index) => (
                      <span
                        key={index}
                        className="w-1 rounded-full bg-accent/70 transition-all"
                        style={{
                          height: `${4 + Math.max(0.04, realtimeLevel) * (10 + (index % 5) * 3)}px`,
                        }}
                      />
                    ))}
                  </div>
                  <span className="text-[11px] text-text-tertiary">
                    Esc to stop
                  </span>
                </div>
                {realtimePartial && (
                  <p className="mt-2 border-t border-accent/10 pt-2 text-sm font-medium text-text-secondary">
                    {realtimePartial}
                    <span className="ml-1 inline-block h-4 w-0.5 animate-pulse bg-accent align-middle" />
                  </p>
                )}
              </div>
            )}

            <div className="flex flex-col px-3">
            <div className="flex-1">
              <TextField
                value={input}
                onChange={setInput}
                isDisabled={disabled || isStreaming || !!dictation?.recording || dictationBusy || !!realtimeMode || realtimeBusy}
                className={`w-full selection:bg-accent/20 ${isHero ? "cowork-hero-input" : ""}`}
              >
                <TextArea
                  ref={textareaRef}
                  onKeyDown={handleKeyDown}
                  onPaste={handlePaste}
                  onCompositionStart={handleCompositionStart}
                  onCompositionEnd={handleCompositionEnd}
                  placeholder={attachments.length > 0 ? t('chat.input.placeholderWithFiles') : (placeholder || t('chat.input.placeholder'))}
                  className={`w-full bg-transparent hover:bg-transparent focus:!ring-0 focus:!outline-none shadow-none border-none px-4 py-3.5 text-[14px] font-medium leading-relaxed custom-scrollbar text-text placeholder:text-text-quaternary/60 resize-none selection:bg-accent/20 ${isHero ? '!min-h-16 !max-h-[240px] overflow-y-auto' : 'min-h-[52px] max-h-[240px]'}`}
                  rows={1}
                />
              </TextField>
            </div>

              <div className="w-full min-h-11 flex items-center justify-between gap-2 px-1 border-t border-border">
                {isHero ? (
                  <>
                    <div className="flex items-center gap-1">
                    <div ref={addMenuRef} className="relative z-[80]">
                      <button
                        type="button"
                        onClick={() => setShowAddMenu((open) => !open)}
                        className="h-8 w-8 rounded-md grid place-items-center text-text-secondary hover:bg-surface-hover"
                        title="Add"
                        aria-label="Add"
                        aria-expanded={showAddMenu}
                      >
                        <span className="text-[22px] leading-none">+</span>
                      </button>
                      {showAddMenu && (
                        <div className="absolute bottom-10 left-0 z-50 w-64 overflow-hidden rounded-xl border border-border bg-surface p-1.5 shadow-xl">
                          <button
                            type="button"
                            onClick={() => { setShowAddMenu(false); void pickFiles() }}
                            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[13px] text-text hover:bg-surface-hover"
                          >
                            <Paperclip size={16} />
                            <span>Add files or photos</span>
                            <span className="ml-auto text-[10px] text-text-tertiary">Ctrl+U</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setShowSkillsMenu((open) => !open)}
                            aria-expanded={showSkillsMenu}
                            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[13px] text-text hover:bg-surface-hover"
                          >
                            <span className="w-4 text-center">✦</span>
                            <span>Skills</span>
                            <span className="ml-auto text-text-tertiary">{showSkillsMenu ? '⌄' : '›'}</span>
                          </button>
                          {showSkillsMenu && (
                            <div className="my-1 max-h-56 overflow-y-auto border-t border-border pt-1">
                              {skills.length > 0 ? skills.map((skill) => (
                                <button
                                  key={skill.name}
                                  type="button"
                                  title={skill.description}
                                  onClick={() => {
                                    const instruction = `Use the "${skill.name}" skill for this task. `
                                    setInput((current) => current.trim() ? `${current.trimEnd()}\n\n${instruction}` : instruction)
                                    setShowSkillsMenu(false)
                                    setShowAddMenu(false)
                                    requestAnimationFrame(() => textareaRef.current?.focus())
                                  }}
                                  className="flex w-full flex-col rounded-lg px-3 py-2 text-left hover:bg-surface-hover"
                                >
                                  <span className="text-[12px] font-medium text-text">{skill.name}</span>
                                  <span className="line-clamp-2 text-[10px] text-text-tertiary">{skill.description}</span>
                                </button>
                              )) : (
                                <p className="px-3 py-3 text-xs text-text-tertiary">No active skills found. Scan skills in Settings → Skills.</p>
                              )}
                            </div>
                          )}
                          <button
                            type="button"
                            onClick={() => setShowAddMenu(false)}
                            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[13px] text-[#302c28] hover:bg-[#f5f2ef]"
                          >
                            <span className="w-4 text-center">▦</span>
                            <span>Connectors</span>
                            <span className="ml-auto text-[#aaa39c]">›</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setShowAddMenu(false)}
                            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[13px] text-[#302c28] hover:bg-[#f5f2ef]"
                          >
                            <span className="w-4 text-center">⌘</span>
                            <span>Plugins</span>
                            <span className="ml-auto text-[#aaa39c]">›</span>
                          </button>
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => void pickFolder()}
                      disabled={disabled || isStreaming}
                      className="h-8 w-8 rounded-md grid place-items-center text-[#625b54] hover:bg-[#f2efec] disabled:opacity-40"
                      title="Choose project folder"
                      aria-label="Choose project folder"
                    >
                      <FolderPlus size={16} />
                    </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <JCodeModelControls compact />
                      <Button
                        type="submit"
                        variant="secondary"
                        size="icon"
                        aria-label="Send message"
                        isDisabled={(!input.trim() && attachments.length === 0) || disabled}
                        className={`w-8 h-8 rounded-lg border border-[#e6e1dc] bg-white text-[#aaa39c] ${input.trim() || attachments.length > 0 ? 'opacity-100 text-[#6f675f]' : 'opacity-70'}`}
                      >
                        <Send size={15} strokeWidth={2.4}/>
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    {isStreaming ? (
                      <Button
                        type="button"
                        variant="danger"
                        size="icon"
                        aria-label="Stop generating"
                        onClick={onAbort}
                        className="ml-auto w-9 h-9 rounded-lg animate-fade-in"
                      >
                        <Square size={16} fill="currentColor" />
                      </Button>
                    ) : (
                      <div className="flex w-full items-center gap-2">
                        <div ref={addMenuRef} className="relative z-[80]">
                          <button
                            type="button"
                            onClick={() => setShowAddMenu((open) => !open)}
                            disabled={disabled || isStreaming}
                            className="h-9 w-9 rounded-lg grid place-items-center text-text-secondary hover:bg-surface-hover disabled:opacity-40"
                            title="Add files or photos"
                            aria-label="Add files or photos"
                            aria-expanded={showAddMenu}
                          >
                            <span className="text-[22px] leading-none">+</span>
                          </button>
                          {showAddMenu && (
                            <div className="absolute bottom-11 left-0 z-50 w-64 overflow-hidden rounded-xl border border-border bg-surface p-1.5 shadow-xl">
                              <button
                                type="button"
                                onClick={() => { setShowAddMenu(false); void pickFiles() }}
                                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[13px] text-text hover:bg-surface-hover"
                              >
                                <Paperclip size={16} />
                                <span>Add files or photos</span>
                                <span className="ml-auto text-[10px] text-text-tertiary">Ctrl+U</span>
                              </button>
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => void pickFolder()}
                          disabled={disabled || isStreaming}
                          className="h-9 w-9 rounded-lg grid place-items-center text-text-secondary hover:bg-surface-hover disabled:opacity-40"
                          title="Choose project folder"
                          aria-label="Choose project folder"
                        >
                          <FolderPlus size={16} />
                        </button>
                        <div className="ml-auto flex items-center gap-2">
                        <JCodeModelControls compact />
                        {isTauriRuntime() && (
                          <>
                            <Button
                              type="button"
                              variant={dictation?.recording ? 'danger' : 'secondary'}
                              size="icon"
                              aria-label={dictation?.recording ? 'Stop dictation' : voiceReady ? 'Start dictation' : 'Configure voice input'}
                              title={dictationRuntimeAvailable === false ? 'Voice input unavailable in this build' : dictation?.recording ? 'Stop and transcribe' : voiceReady ? 'Local voice input' : 'Configure voice input first'}
                              isDisabled={dictationBusy || disabled || isStreaming || !!realtimeMode || realtimeBusy || dictationRuntimeAvailable === false}
                              onClick={() => void toggleDictation()}
                              className={`w-9 h-9 rounded-lg ${!voiceReady && !dictation?.recording ? 'opacity-45' : ''}`}
                            >
                              {dictationBusy ? <LoaderCircle size={17} className="animate-spin" /> : dictation?.recording ? <Square size={15} fill="currentColor" /> : <Mic size={18} />}
                            </Button>
                            <Button
                              type="button"
                              variant={realtimeMode === 'dictation' ? 'danger' : 'secondary'}
                              size="icon"
                              aria-label={realtimeMode === 'dictation' ? 'Stop live captions' : 'Start live captions'}
                              title={voiceRuntimeAvailable === false ? 'Real-time voice unavailable in this build' : realtimeMode === 'dictation' ? 'Stop live captions' : 'Live partial captions'}
                              isDisabled={disabled || isStreaming || dictationBusy || !!dictation?.recording || realtimeBusy || conversation.active || voiceRuntimeAvailable === false}
                              onClick={() => void toggleRealtimeDictation()}
                              className={`w-9 h-9 rounded-lg ${!realtimeReady && realtimeMode !== 'dictation' ? 'opacity-45' : ''}`}
                            >
                              {realtimeBusy && realtimeMode !== 'conversation' ? <LoaderCircle size={17} className="animate-spin" /> : realtimeMode === 'dictation' ? <Square size={15} fill="currentColor" /> : <AudioLines size={18} />}
                            </Button>
                            <Button
                              type="button"
                              variant={conversation.active ? 'danger' : 'secondary'}
                              size="icon"
                              aria-label={conversation.active ? 'Stop voice conversation' : 'Start voice conversation'}
                              title={voiceRuntimeAvailable === false ? "Voice conversation unavailable in this build" : "Voice conversation"}
                              isDisabled={disabled || !!dictation?.recording || dictationBusy || (isStreaming && !conversation.active) || (realtimeMode === 'dictation') || voiceRuntimeAvailable === false}
                              onClick={() => void toggleConversation()}
                              className={`w-9 h-9 rounded-lg ${!conversationReady && !conversation.active ? 'opacity-45' : ''}`}
                            >
                              {realtimeBusy && realtimeMode === 'conversation' ? <LoaderCircle size={17} className="animate-spin" /> : conversation.active && conversation.state !== 'speaking' ? <Square size={15} fill="currentColor" /> : <PhoneCall size={18} />}
                            </Button>
                          </>
                        )}
                        <Button
                          type="submit"
                          variant="primary"
                          size="icon"
                          aria-label="Send message"
                          isDisabled={(!input.trim() && attachments.length === 0) || disabled || !!dictation?.recording || dictationBusy || !!realtimeMode || realtimeBusy}
                          className={`w-9 h-9 rounded-lg transition-colors duration-150 ${(input.trim() || attachments.length > 0) && !dictation?.recording && !dictationBusy && !realtimeMode && !realtimeBusy ? 'opacity-100' : 'opacity-30 pointer-events-none'}`}
                        >
                          <Send size={18} strokeWidth={3} className={input.trim() || attachments.length > 0 ? 'translate-x-0.5 -translate-y-0.5' : ''}/>
                        </Button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>            </div>
          </div>
        </Card>
      </form>
    </div>
  )
}
