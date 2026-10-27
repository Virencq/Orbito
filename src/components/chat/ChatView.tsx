import { useState, useCallback, useRef, useEffect } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useTranslation } from 'react-i18next'
import { useAppStore, useAgentStore, useWebSearchStore, usePetStore } from '../../stores'
import { useSkillStore } from '../../stores/skillStore'
import { useMCPStore } from '../../stores/mcpStore'
import { useFilePreviewStore } from '../../stores/filePreviewStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { invoke } from '@tauri-apps/api/core'
import { recordPerformance, startPerformanceTimer, elapsedPerformanceMs } from '../../utils/performanceDiagnostics'
import type { ImageAttachment } from './ChatInput'
import { Paperclip, FolderTree, MessagesSquare, ShieldAlert, Sparkles, ArrowUp, FolderKanban, ChevronDown, Asterisk } from 'lucide-react'
import { MessageList } from './MessageList'
import { ChatInput } from './ChatInput'
import { FilePreviewPanel } from '../preview'
import * as JCode from '../../utils/jcodeClient'
import {
  getVoiceConversation,
  setVoiceConversation,
  speakVoiceConversationResponse,
} from '../../utils/voiceConversation'
import type { KiloMessage } from '../../types'
import { motion, AnimatePresence } from 'framer-motion'
import { assembleAgentSystemPrompt } from '../../utils/agentPrompt'
import { buildWorkspacePromptContext } from '../../utils/workspacePromptContext'
import { readProjectInstructionFiles } from '../../utils/projectInstructionFiles'
import {
  assembleAgentRuntimePrompt,
  formatAgentSkillsBlock,
  resolveAgentSkillNames,
} from '../../utils/agentRuntime'

const EMPTY_MESSAGES: never[] = []
const EMPTY_STREAMING = null

export function ChatView({ embedded = false, workspaceMode = 'cowork', initialPrompt, onInitialPromptHandled, onOpenProjects }: { embedded?: boolean; workspaceMode?: 'cowork' | 'code'; initialPrompt?: { id: string; text: string } | null; onInitialPromptHandled?: (id: string) => void; onOpenProjects?: () => void }) {
  const { t } = useTranslation()
  const {
    activeSessionId: coworkActiveSessionId,
    codeActiveSessionId,
    setCodeActiveSessionId,
    markCodeSession,
    sessions,
    workspaceDir: coworkWorkspaceDir,
    codeWorkspaceDir,
    leftPanelMode,
    setLeftPanelMode,
    sidebarCollapsed,
    toggleSidebar,
    startStreaming,
    appendStreamingDelta,
    finishStreaming,
    deleteMessage,
    deleteMessagesFrom,
    commitStreamingMessage,
    addMessage,
    updateSessionTitle,
  } = useAppStore(useShallow((s) => ({
    activeSessionId: s.activeSessionId,
    codeActiveSessionId: s.codeActiveSessionId,
    setCodeActiveSessionId: s.setCodeActiveSessionId,
    markCodeSession: s.markCodeSession,
    sessions: s.sessions,
    workspaceDir: s.workspaceDir,
    codeWorkspaceDir: s.codeWorkspaceDir,
    leftPanelMode: s.leftPanelMode,
    setLeftPanelMode: s.setLeftPanelMode,
    sidebarCollapsed: s.sidebarCollapsed,
    toggleSidebar: s.toggleSidebar,
    startStreaming: s.startStreaming,
    appendStreamingDelta: s.appendStreamingDelta,
    finishStreaming: s.finishStreaming,
    deleteMessage: s.deleteMessage,
    deleteMessagesFrom: s.deleteMessagesFrom,
    commitStreamingMessage: s.commitStreamingMessage,
    addMessage: s.addMessage,
    updateSessionTitle: s.updateSessionTitle,
  })))
  const activeSessionId = workspaceMode === 'code' ? codeActiveSessionId : coworkActiveSessionId
  const workspaceDir = workspaceMode === 'code' ? codeWorkspaceDir : coworkWorkspaceDir
  const activeProject = useWorkspaceStore((state) => workspaceMode === 'code'
    ? state.codeProjects.find((project) => project.id === state.activeCodeProjectId)
    // In Cowork, a folder is shown as the chat's project only when the chat is
    // explicitly linked to that project. A leftover global workspaceDir must
    // not make an unrelated/new chat appear to belong to a project.
    : activeSessionId
      ? state.projects.find((project) => project.sessionId === activeSessionId || project.sessionIds?.includes(activeSessionId))
      : undefined)
  const setModeActiveSession = useCallback((id: string | null) => {
    if (workspaceMode === 'code') { setCodeActiveSessionId(id); if (id) markCodeSession(id) }
    else useAppStore.getState().setActiveSession(id)
  }, [workspaceMode, setCodeActiveSessionId, markCodeSession])
  const createModeSession = useCallback(() => {
    if (workspaceMode === 'code') return useAppStore.getState().createCodeSession()
    return useAppStore.getState().createSession()
  }, [workspaceMode])
  const [error, setError] = useState<string | null>(null)
  const [draftValue, setDraftValue] = useState<string | null>(null)
  const [pendingEditMessage, setPendingEditMessage] = useState<{ sessionId: string; messageId: string } | null>(null)
  const [contextStatus, setContextStatus] = useState<JCode.ContextStatus | null>(null)
  const handledInitialPromptRef = useRef<string | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [dragTargetZone, setDragTargetZone] = useState<'message' | 'input'>('message')
  const [showPermissionPopup, setShowPermissionPopup] = useState(false)
  const [pendingApproval, setPendingApproval] = useState<{ requestId: string; toolName: string; args: any; reason?: string; piSessionId: string } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const streamUnsubsRef = useRef(new Map<string, () => void>())
  const promptStartedAtRef = useRef<number | null>(null)
  const firstOutputLoggedRef = useRef(false)

  const subscribeStream = useCallback(async (jcodeSessionId: string, sid: string) => {
    streamUnsubsRef.current.get(jcodeSessionId)?.()
    let unsubscribe = () => {}
    unsubscribe = await JCode.subscribeStream(jcodeSessionId, {
      onText: (partPid, delta) => {
        if (!firstOutputLoggedRef.current && promptStartedAtRef.current !== null) {
          firstOutputLoggedRef.current = true
          recordPerformance('prompt.first-text-chunk', { timeToFirstOutputMs: elapsedPerformanceMs(promptStartedAtRef.current), mode: workspaceMode })
        }
        if (useAppStore.getState().streamingMessage[sid]) {
          useAppStore.getState().appendStreamingDelta(sid, partPid, delta)
        }
      },
      onThinking: (delta) => {
        const sm = useAppStore.getState().streamingMessage[sid]
        if (!sm) return
        // Keep one reasoning part for the whole assistant turn. Creating a new
        // timestamp ID after every tool/text transition produced duplicate cards.
        const reasoningId = `jcode-reasoning-${sm.messageID}`
        const existing = sm.parts.find((part) => part.id === reasoningId)
        if (existing) {
          useAppStore.getState().appendStreamingDelta(sid, reasoningId, delta)
        } else {
          useAppStore.getState().updateStreamingPart(sid, reasoningId, {
            id: reasoningId, type: 'reasoning', text: delta,
            sessionID: sid, messageID: sm.messageID,
          } as any)
        }
      },
      onToolCall: (id, name, args) => {
        console.log('[Cowork] Tool call:', name, id)
        usePetStore.getState().onWorking()
        const sm = useAppStore.getState().streamingMessage[sid]
        if (!sm) return
        useAppStore.getState().updateStreamingPart(sid, id, {
          id, type: 'tool', name, args, callID: id,
          tool: name, state: { status: 'running' as const },
          sessionID: sid, messageID: sm.messageID,
        } as any)
      },
      onToolResult: (id, name, result) => {
        const sm = useAppStore.getState().streamingMessage[sid]
        if (!sm) return
        useAppStore.getState().updateStreamingPart(sid, id, {
          id, type: 'tool', name, tool: name, callID: id,
          state: { status: 'completed' as const, output: JSON.stringify((result as any)?.content?.[0]?.text || result) },
          sessionID: sid, messageID: sm.messageID,
        } as any)
      },
      onToolApproval: (request) => {
        setPendingApproval({ ...request, piSessionId: jcodeSessionId })
      },
      onStatus: (status) => {
        if (status.type === 'compacting' || status.type === 'compacted') {
          setContextStatus(status)
        }
      },
      onDone: () => {
        unsubscribe()
        streamUnsubsRef.current.delete(jcodeSessionId)
      },
    })
    streamUnsubsRef.current.set(jcodeSessionId, unsubscribe)
  }, [])

  const session = sessions.find((s) => s.id === activeSessionId)
  // Subscribe only to the visible conversation. Subscribing to the entire map made
  // this view rerender whenever any background/other session loaded its history.
  const messages = useAppStore((state) =>
    activeSessionId ? state.sessionMessages[activeSessionId] || EMPTY_MESSAGES : EMPTY_MESSAGES,
  )
  const isEmpty = messages.length === 0
  const isReadOnlySession = !!session?.readOnly

  const handleToggleLeftPanel = useCallback(() => {
    const nextMode = leftPanelMode === 'sessions' ? 'files' : 'sessions'
    setLeftPanelMode(nextMode)
    if (sidebarCollapsed) {
      toggleSidebar()
    }
  }, [leftPanelMode, setLeftPanelMode, sidebarCollapsed, toggleSidebar])

  const handleSubmit = useCallback(
    async (content: string, images?: ImageAttachment[]) => {
      const submitStartedAt = startPerformanceTimer()
      let sid = workspaceMode === 'code' ? useAppStore.getState().codeActiveSessionId : useAppStore.getState().activeSessionId
      if ((!content || !content.trim()) && (!images || images.length === 0)) return
      promptStartedAtRef.current = null
      firstOutputLoggedRef.current = false
      recordPerformance('prompt.submit.begin', { mode: workspaceMode, hasImages: Boolean(images?.length), textLength: content.length })
      if (!sid) {
        sid = createModeSession()
      }
      setError(null)
      setContextStatus(null)
      setDraftValue(null)

      if (isReadOnlySession) {
        setError(t('chat.session.readOnlyHint'))
        return
      }

      // JCode is the runtime and owns provider/model selection. Cowork never supplies
      // provider credentials, provider IDs, or model IDs to ACP.

      // Editing is non-destructive until the user submits the revised prompt.
      // Only then remove that prompt and its later turns, preserving history if
      // the user decides not to send the edit.
      if (pendingEditMessage) {
        if (pendingEditMessage.sessionId === sid) {
          deleteMessagesFrom(sid, pendingEditMessage.messageId)
        }
        setPendingEditMessage(null)
      }

      // Add user message
      const uid = Math.random().toString(36).substring(2, 15)
      addMessage(sid, {
        info: { id: uid, sessionID: sid, role: 'user', time: { created: Date.now() } },
        parts: [{ id: `${uid}-0`, type: 'text', text: content, sessionID: sid, messageID: uid }],
      })

      const currentSession = useAppStore.getState().sessions.find((item) => item.id === sid)
      if (currentSession?.title === 'New Chat') {
        updateSessionTitle(sid, content.slice(0, 40) + (content.length > 40 ? '...' : ''))
      }

      // JCode owns MCP configuration and tool execution. Do not synchronize
      // Orbito's MCP store on every prompt; that adds startup latency and creates
      // a second source of truth.

      // Create or reuse JCode session
      let pid = (useAppStore.getState().sessions.find(s => s.id === sid) as any)?.piId ?? null
      if (!pid) {
        const createSessionStartedAt = startPerformanceTimer()
        recordPerformance('prompt.jcode-session-create.begin', { mode: workspaceMode })
        try {
          const ks = await JCode.createSession(workspaceDir ?? undefined)
          recordPerformance('prompt.jcode-session-create.complete', { durationMs: elapsedPerformanceMs(createSessionStartedAt) })
          pid = ks.id
          useAppStore.getState().setSessionPiId(sid, pid)
        } catch (error) {
          recordPerformance('prompt.jcode-session-create.failed', { durationMs: elapsedPerformanceMs(createSessionStartedAt), failed: true })
          setError(t('chat.errors.sessionFailed'))
          usePetStore.getState().onError()
          return
        }
      }

      // Subscribe for streaming visual feedback
      const subscribeStartedAt = startPerformanceTimer()
      await subscribeStream(pid, sid)
      recordPerformance('prompt.stream-subscription.ready', { durationMs: elapsedPerformanceMs(subscribeStartedAt) })

      // Build context
      const agentStore = useAgentStore.getState()
      const activeAgent = agentStore.activeAgentId
        ? agentStore.agents.find((a) => a.id === agentStore.activeAgentId) : null

      const skillStore = useSkillStore.getState()
      const enabledSkills = resolveAgentSkillNames(activeAgent ?? null, skillStore.skills)
        .map(n => skillStore.skills.find(s => s.name === n))
        .filter((s): s is NonNullable<typeof s> => s !== undefined && s.enabled)
      const agentSkillsBlock = formatAgentSkillsBlock(enabledSkills)

      const { blocks, mcpToolDefs, allowedSseMcpToolNames } = buildWorkspacePromptContext(
        workspaceMode,
        workspaceDir,
        activeAgent ?? null,
      )
      // Read all supported project instruction files on every turn. Keep legacy
      // Claude instructions and shared AGENTS instructions active alongside JCode-specific
      // instructions; exact duplicate contents are de-duplicated by the shared loader.
      const projectFileInstructionBlocks: string[] = []
      const projectInstructionDirectory = activeProject?.path || workspaceDir
      if (projectInstructionDirectory) {
        const seenInstructionContents = new Set<string>()
        for (const file of await readProjectInstructionFiles(projectInstructionDirectory)) {
          if (seenInstructionContents.has(file.content)) continue
          seenInstructionContents.add(file.content)
          projectFileInstructionBlocks.push(`### ${file.name}\n${file.content}`)
        }
      }

      let enrichedContent = content
      const allContextBlocks = [...blocks, ...projectFileInstructionBlocks.map((block) => `## Project Instruction File\n${block}`)]
      if (allContextBlocks.length > 0) {
        const header = activeAgent ? `[Agent: ${activeAgent.name}]` : '[Global Context]'
        enrichedContent = `${header}\n---\n${allContextBlocks.join('\n\n')}\n---\n\n${content}`
      }

      // Optional UI hints are forwarded to the JCode adapter when present.
      // An empty model is valid: JCode will use its configured default model.
      startStreaming(sid, 'pending-' + Date.now())

      usePetStore.getState().onThinking()

      const agentSystemPrompt = assembleAgentRuntimePrompt(
        activeAgent
          ? assembleAgentSystemPrompt(activeAgent, {
            userProfile: agentStore.userProfile,
            voice: getVoiceConversation().active,
            workspaceDir: workspaceDir ?? undefined,
          })
          : undefined,
        agentSkillsBlock,
      )

      const promptOptions = {
        systemPrompt: agentSystemPrompt,
        workspaceDir: workspaceDir ?? undefined,
        workspaceRoots: activeAgent?.workspaceRoots || [],
        webSearchConfig: useWebSearchStore.getState().getActiveConfig(),
        tools: mcpToolDefs,
        allowedSseMcpToolNames: activeAgent ? allowedSseMcpToolNames : undefined,
        permissionMode: activeAgent?.permissionMode,
        permissionRules: activeAgent?.permissionRules,
        images,
      }

      promptStartedAtRef.current = startPerformanceTimer()
      recordPerformance('prompt.acp-request.begin', { mode: workspaceMode, setupDurationMs: elapsedPerformanceMs(submitStartedAt) })
      let result = await JCode.prompt(pid!, enrichedContent, promptOptions)
      recordPerformance('prompt.acp-request.completed', { durationMs: elapsedPerformanceMs(promptStartedAtRef.current), hadError: Boolean(result.error) })

      // ACP session IDs are process-local. Recover automatically if an old
      // Cowork session contains an ID from a JCode process that has exited.
      if (result.error && /session not found/i.test(result.error)) {
        try {
          const fresh = await JCode.createSession(workspaceDir ?? undefined)
          pid = fresh.id
          useAppStore.getState().setSessionPiId(sid, pid)
          await subscribeStream(pid, sid)
          result = await JCode.prompt(pid, enrichedContent, promptOptions)
        } catch (retryError) {
          result = {
            text: '',
            error: retryError instanceof Error ? retryError.message : String(retryError),
          }
        }
      }

      if (result.error) {
        setError(result.error)
        finishStreaming(sid)
        usePetStore.getState().onError()
        if (getVoiceConversation().active) {
          setVoiceConversation(false, 'error', result.error)
        }
        return
      }

      const msgID = `pi-msg-${Date.now()}`
      const sm = useAppStore.getState().streamingMessage[sid]
      const accumulatedParts = sm?.parts || []
      const textPart = accumulatedParts.find(p => p.type === 'text')
      if (textPart && 'text' in textPart && result.text) {
        (textPart as any).text = result.text
      }
      // If no text part was created during streaming, ensure one exists
      // (happens when model only emits thinking_delta but no text_delta)
      if (!accumulatedParts.find(p => p.type === 'text')) {
        // Use result text first, then fallback to last reasoning text
        const fallbackText = result.text
          || accumulatedParts.filter(p => p.type === 'reasoning').pop()?.text
          || ''
        accumulatedParts.push({
          id: `pi-text-${Date.now()}`,
          type: 'text', text: fallbackText,
          sessionID: sid, messageID: msgID,
        } as any)
      }

      const completedMessage: KiloMessage = {
        info: { id: msgID, sessionID: sid, role: 'assistant', time: { created: Date.now() } },
        parts: accumulatedParts,
      }

      commitStreamingMessage(sid, completedMessage)
      const responseText = accumulatedParts
        .filter((part) => part.type === 'text' && 'text' in part)
        .map((part) => ('text' in part ? part.text : ''))
        .join('\n')
      void speakVoiceConversationResponse(responseText)
      useAppStore.getState().incrementFileTreeVersion()
      usePetStore.getState().onResponded()
    },
    [activeSessionId, session, t, startStreaming, finishStreaming, commitStreamingMessage, addMessage, updateSessionTitle, appendStreamingDelta, subscribeStream, isReadOnlySession, workspaceMode, workspaceDir, createModeSession, pendingEditMessage, deleteMessagesFrom],
  )

  useEffect(() => {
    if (!initialPrompt || !activeSessionId || handledInitialPromptRef.current === initialPrompt.id) return
    handledInitialPromptRef.current = initialPrompt.id
    void handleSubmit(initialPrompt.text).finally(() => {
      onInitialPromptHandled?.(initialPrompt.id)
    })
  }, [initialPrompt?.id, activeSessionId, handleSubmit, onInitialPromptHandled])

  const activeJCodeSessionId = activeSessionId
    ? (sessions.find((s) => s.id === activeSessionId) as any)?.piId ?? ''
    : ''

  const handleEditMessage = useCallback((message: KiloMessage) => {
    if (message.info.role !== 'user' || !activeSessionId) return
    const content = message.parts
      .filter((part) => part.type === 'text')
      .map((part) => 'text' in part ? part.text : '')
      .join('\n')
      .trim()
    if (!content) return

    // Do not mutate the conversation merely by clicking Edit. Keep the original
    // turns intact until the revised prompt is actually submitted.
    setPendingEditMessage({ sessionId: activeSessionId, messageId: message.info.id })
    setDraftValue(content)
  }, [activeSessionId])

  const handleDeleteMessage = useCallback((message: KiloMessage) => {
    if (!activeSessionId) return
    if (message.info.role === 'user') {
      // Keep the conversation coherent: deleting a prompt also removes its following response/tool work.
      deleteMessagesFrom(activeSessionId, message.info.id)
    } else {
      deleteMessage(activeSessionId, message.info.id)
    }
  }, [activeSessionId, deleteMessage, deleteMessagesFrom])

  const abort = useCallback(() => {
    if (activeJCodeSessionId) {
      JCode.abortSession(activeJCodeSessionId)
      streamUnsubsRef.current.get(activeJCodeSessionId)?.()
      streamUnsubsRef.current.delete(activeJCodeSessionId)
    }
    if (activeSessionId) finishStreaming(activeSessionId)
    if (getVoiceConversation().active) setVoiceConversation(false)
    usePetStore.getState().onResponded()
  }, [activeJCodeSessionId, activeSessionId, finishStreaming])

  // ── File/folder drag into message area ──

  async function listFilesRecursive(dirPath: string, maxFiles = 30, depth = 0): Promise<string[]> {
    if (depth > 5 || maxFiles <= 0) return []
    const { invoke } = await import('@tauri-apps/api/core')
    const entries = await invoke<any[]>('list_directory', { path: dirPath })
    const skipDirs = new Set(['node_modules', '.git', 'target', '__pycache__', 'dist', '.next', '.cache'])
    let results: string[] = []
    for (const entry of entries) {
      if (entry.is_dir) {
        if (skipDirs.has(entry.name)) continue
        const sub = await listFilesRecursive(entry.path, maxFiles - results.length, depth + 1)
        results = results.concat(sub)
      } else {
        results.push(entry.path)
        if (results.length >= maxFiles) break
      }
    }
    return results
  }

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setIsDragOver(true)
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect()
      const relativeY = e.clientY - rect.top
      const inputZoneStart = rect.height * 0.6
      setDragTargetZone(relativeY > inputZoneStart ? 'input' : 'message')
    }
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
    setDragTargetZone('message')

    // Snapshot native files immediately. Some desktop/Tauri drag payloads can
    // become unavailable after async work starts.
    const nativeFiles = Array.from(e.dataTransfer?.files || [])

    try {
      const fileData = e.dataTransfer.getData('application/x-cowork-file')
      if (fileData) {
        const { path, name, isDir } = JSON.parse(fileData)

        const imageExts = /\.(png|jpg|jpeg|gif|webp|bmp)$/i
        if (!isDir && imageExts.test(name)) {
          try {
            const base64 = await invoke<string>('read_file_base64', { path })
            const mimeType = name.endsWith('.png') ? 'image/png' :
              name.endsWith('.gif') ? 'image/gif' :
              name.endsWith('.webp') ? 'image/webp' :
              name.endsWith('.bmp') ? 'image/bmp' : 'image/jpeg'
            const text = `[Image: ${name}](${path})`
            if (!(workspaceMode === 'code' ? useAppStore.getState().codeActiveSessionId : useAppStore.getState().activeSessionId)) createModeSession()
            await handleSubmit(text, [{ data: base64, mimeType }])
          } catch {
            await handleSubmit(`[File: ${name}](${path})`)
          }
          return
        }

        if (isDir) {
          // Do not recursively enumerate a dropped folder in the UI thread.
          // Send the folder reference and let JCode inspect it when needed.
          if (!(workspaceMode === 'code' ? useAppStore.getState().codeActiveSessionId : useAppStore.getState().activeSessionId)) createModeSession()
          await handleSubmit(`[Folder: ${name}](${path})`)
          return
        }

        if (!(workspaceMode === 'code' ? useAppStore.getState().codeActiveSessionId : useAppStore.getState().activeSessionId)) createModeSession()
        await handleSubmit(`[File: ${name}](${path})`)
        return
      }

      if (nativeFiles.length === 0) return

      const nonZipFiles = nativeFiles.filter(
        (file) => !file.name.toLowerCase().endsWith('.zip') &&
          file.type !== 'application/zip' &&
          file.type !== 'application/x-zip-compressed',
      )
      if (nonZipFiles.length === 0) return

      const refs = nonZipFiles.map((file) => `[File: ${file.name}](os-file://${file.name})`).join('\n')
      if (!(workspaceMode === 'code' ? useAppStore.getState().codeActiveSessionId : useAppStore.getState().activeSessionId)) createModeSession()
      await handleSubmit(refs)
    } catch (error) {
      console.error('[ChatView] drop failed:', error)
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setIsDragOver(false)
    }
  }, [handleSubmit, workspaceMode, createModeSession])
  const isStreaming = useAppStore((state) => !!(activeSessionId && state.streamingMessage[activeSessionId]?.isStreaming))

  const filePreview = useFilePreviewStore((s) => s.preview)

  if (!activeSessionId) {
    const homeSessions = useAppStore.getState().sessions
      .slice()
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 3)

    return (
      <div className="cowork-home flex-1 h-full overflow-auto bg-bg">
        <div className="min-h-full flex flex-col">
          <div className="flex-1 flex flex-col items-center pt-[264px] px-8">
            <div className="mb-11 flex items-center justify-center gap-3">
              <div className="h-10 w-10 grid place-items-center text-[#df7650]"><Asterisk size={39} strokeWidth={1.7}/></div>
              <h1 className="cowork-home-greeting font-serif text-[39px] leading-none tracking-[-0.04em]" style={{ color: "var(--color-text)" }}>
                You’re here!
              </h1>
            </div>

            <div className="w-full max-w-[674px]">
              <ChatInput
                onSubmit={handleSubmit}
                onAbort={abort}
                isStreaming={false}
                variant="hero"
                placeholder="Type / for skills"
              />
            </div>

            <div className="w-full max-w-[674px] -mt-1">
              <div className="h-9 flex items-center gap-2 px-6 text-[12px]" style={{ color: 'var(--color-text-secondary)' }}>
                <FolderKanban size={14}/>
                <span>Project or folder</span>
                <ChevronDown size={13}/>
                <span className="ml-auto" style={{ color: 'var(--color-text-tertiary)' }}>ⓘ</span>
              </div>
            </div>

            <div className="w-full max-w-[674px] mt-12">
              <div className="flex items-end justify-between mb-3">
                <span className="text-[12px]" style={{ color: 'var(--color-text-secondary)' }}>Active</span>
                <button className="text-[12px] hover:text-text" style={{ color: 'var(--color-text-secondary)' }}>Clear active</button>
              </div>
              {homeSessions.length > 0 ? (
                <div className="px-1">
                  {homeSessions.slice(0, 1).map(session => (
                    <button key={session.id} onClick={() => { setModeActiveSession(session.id) }}
                      className="w-full text-left flex items-center gap-3 py-1.5 hover:bg-surface-hover rounded-md">
                      <span style={{ color: 'var(--color-text-secondary)' }}>☷</span>
                      <span className="h-1.5 w-1.5 rounded-full bg-[#3b82f6]"/>
                      <div className="min-w-0">
                        <div className="text-[12px] truncate" style={{ color: 'var(--color-text)' }}>{session.title || 'Untitled task'}</div>
                        <div className="text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>recently</div>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="flex items-center gap-3 px-1 py-2" style={{ color: 'var(--color-text-secondary)' }}>
                  <span className="text-text-secondary">☷</span>
                  <span className="text-[12px]">No active tasks</span>
                </div>
              )}

              <div className="mt-12 mb-2 text-[12px]" style={{ color: 'var(--color-text-secondary)' }}>Scheduled</div>
              <div className="h-24" />
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className={`flex-1 min-h-0 min-w-0 flex h-full w-full overflow-hidden relative ${embedded ? "bg-white" : ""}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Main chat area */}
      <div className="flex-1 min-h-0 min-w-0 flex flex-col bg-transparent h-full overflow-hidden relative">
        {!embedded && <div className="absolute top-4 right-4 z-40">
          <button
            onClick={handleToggleLeftPanel}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-[11px] font-semibold text-text-secondary transition-colors duration-150 hover:border-accent/30 hover:text-accent"
          >
            {leftPanelMode === 'files' ? <MessagesSquare size={14} /> : <FolderTree size={14} />}
            {leftPanelMode === 'files' ? t('chat.layout.backToSessions') : t('chat.layout.openFiles')}
          </button>
        </div>}
        {isDragOver && dragTargetZone === 'message' && (
          <div className="absolute inset-0 z-50 flex items-center justify-center pointer-events-none rounded-[inherit]">
            <div className="w-full h-full mx-4 my-4 rounded-[28px] border-2 border-dashed border-accent/50 bg-accent/5 backdrop-blur-[2px] flex flex-col items-center justify-center gap-4 animate-fade-in">
              <div className="w-16 h-16 rounded-full bg-accent/10 flex items-center justify-center">
                <Paperclip size={28} className="text-accent" />
              </div>
              <p className="text-lg font-bold text-accent tracking-tight">Drop files or folders here to send</p>
              <p className="text-sm text-text-tertiary font-medium">Files will be sent to JCode for analysis</p>
            </div>
          </div>
        )}
        <div className="flex-1 min-h-0 min-w-0 h-full flex flex-col overflow-hidden relative bg-transparent">
          {activeSessionId && session && !isEmpty && (
            <div className="relative z-20 flex h-12 shrink-0 items-center gap-2 border-b border-border/70 px-5 pr-24 text-[13px]">
              <button
                type="button"
                onClick={() => { if (workspaceMode === 'cowork') onOpenProjects?.() }}
                disabled={workspaceMode !== 'cowork' || !onOpenProjects}
                className="min-w-0 max-w-[38%] truncate text-left font-medium text-white hover:text-[#f0a078] disabled:cursor-default disabled:hover:text-white transition-colors"
                title={workspaceMode === 'cowork' ? (activeProject?.name || 'No project selected') : (activeProject?.name || workspaceDir || 'Workspace')}
                aria-label={workspaceMode === 'cowork' ? (activeProject?.name || 'No project selected') : (activeProject?.name || 'Workspace')}
              >
                {workspaceMode === 'cowork'
                  ? (activeProject?.name || 'New chat')
                  : (activeProject?.name || workspaceDir?.split(/[\\/]/).filter(Boolean).pop() || 'Workspace')}
              </button>
              <ChevronDown size={13} className="shrink-0 rotate-[-90deg] text-white/60" />
              <span className="min-w-0 truncate font-semibold text-white" title={session.title || 'New Chat'}>
                {session.title || 'New Chat'}
              </span>
            </div>
          )}
          <div className="flex-1 min-h-0 min-w-0 relative overflow-hidden">
          <AnimatePresence mode="wait">
            {isEmpty ? (
              <motion.div
                key="empty-task"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="h-full flex flex-col items-center justify-center px-4"
              >
                <div className="w-full max-w-[674px]">
                  <div className="mb-8 text-center">
                    <h2 className="font-serif text-[34px] leading-tight tracking-[-0.035em]" style={{ color: 'var(--color-text)' }}>
                      What can I help you with?
                    </h2>
                    <p className="mt-2 text-[13px]" style={{ color: 'var(--color-text-secondary)' }}>
                      Start a task and JCode will work through it with you.
                    </p>
                  </div>
                  <ChatInput
                    onSubmit={handleSubmit}
                    onAbort={abort}
                    isStreaming={false}
                    variant="hero"
                    placeholder="What would you like me to do?"
                  />
                  <div className="mt-2 h-9 flex items-center gap-2 px-4 text-[12px]" style={{ color: 'var(--color-text-secondary)' }}>
                    <FolderKanban size={14}/>
                    <span>Project or folder</span>
                    <ChevronDown size={13}/>
                    <span className="ml-auto text-[#a39d96]">ⓘ</span>
                  </div>
                </div>
              </motion.div>
            ) : (
              <motion.div key={activeSessionId} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }} className="h-full flex flex-col w-full max-w-none mx-auto relative overflow-hidden px-1">
                {session && (session.sourceLabel || session.readOnly) && (
                  <div className="sticky top-0 z-10 px-3 pt-2">
                    <div className="rounded-lg border border-border bg-surface px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[13px] font-bold tracking-tight text-text">{session.title}</span>
                        {session.sourceLabel && (
                          <span className="inline-flex items-center rounded-full border border-accent/20 bg-accent/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-accent">
                            {session.sourceLabel}
                          </span>
                        )}
                        {session.readOnly && (
                          <span className="inline-flex items-center rounded-full border border-border-light bg-surface-secondary/70 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-text-tertiary">
                            {t('chat.session.readOnly')}
                          </span>
                        )}
                      </div>
                      {session.readOnly && (
                        <p className="mt-2 text-[12px] font-medium text-text-tertiary">
                          {t('chat.session.readOnlyHint')}
                        </p>
                      )}
                    </div>
                  </div>
                )}
                <MessageList sessionId={activeSessionId!} onEdit={handleEditMessage} onDelete={handleDeleteMessage} />
                {error && (
                  <div className="absolute top-6 left-4 right-4 z-20 flex items-center gap-4 p-4 rounded-lg bg-surface text-red-500 text-[13px] font-semibold border border-red-500/20 shadow-lg">
                    <span>{error}</span>
                    <button onClick={() => setError(null)} className="ml-auto text-red-500 hover:opacity-70 text-[10px] font-bold uppercase tracking-[0.2em]">{t('chat.errors.dismiss')}</button>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
          </div>
        </div>
        <div className={`bg-linear-to-t from-bg to-transparent pt-1 pb-2 shrink-0 ${isEmpty ? "hidden" : ""}`}>
          <div className="w-full max-w-none mx-auto relative px-1">
            {contextStatus && (
              <div className="mb-2 flex justify-center" role="status" aria-live="polite">
                <div className="rounded-full border border-accent/20 bg-accent/8 px-3 py-1 text-[10px] font-semibold text-text-secondary">
                  {contextStatus.type === 'compacting'
                    ? 'Organizing earlier conversation context…'
                    : `Context compacted${contextStatus.tokensBefore && contextStatus.tokensAfter
                      ? ` · ${contextStatus.tokensBefore.toLocaleString()} → ${contextStatus.tokensAfter.toLocaleString()} tokens`
                      : ''}`}
                </div>
              </div>
            )}
            <ChatInput
                  onSubmit={handleSubmit}
                  onAbort={abort}
                  isStreaming={isStreaming}
                  disabled={isReadOnlySession}
                  placeholder={isReadOnlySession ? t('chat.session.readOnlyPlaceholder') : t('chat.input.placeholder')}
                  draftValue={draftValue}
                />
          </div>
        </div>
      </div>

      {/* File preview panel */}
      <AnimatePresence>
        {!embedded && filePreview && (
          <motion.div
            key="file-preview"
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 480, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
            className="h-full overflow-hidden shrink-0"
          >
            <FilePreviewPanel />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Tool approval dialog */}
      {pendingApproval && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/40 backdrop-blur-md" onClick={() => { JCode.sendToolApproval(pendingApproval.piSessionId, pendingApproval.requestId, false); setPendingApproval(null) }}>
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="w-full max-w-sm bg-white dark:bg-surface rounded-2xl shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Top accent bar */}
            <div className="h-1.5 bg-gradient-to-r from-amber-400 to-amber-500" />

            <div className="p-6 pb-5">
              <div className="flex items-start gap-4 mb-5">
                <div className="relative shrink-0">
                  <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center ring-1 ring-amber-500/20">
                    <ShieldAlert size={18} className="text-amber-500" />
                  </div>
                  <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-amber-500 animate-pulse" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-[15px] font-bold text-text tracking-tight">{t('chat.toolApproval.title')}</h3>
                  <p className="text-[12px] text-text-tertiary mt-0.5">{t('chat.toolApproval.subtitle')}</p>
                </div>
              </div>

              {/* Tool card */}
              <div className="rounded-xl bg-surface-secondary/40 border border-border-light/60 p-4 mb-5">
                <div className="flex items-center gap-2.5 mb-3">
                  <code className="text-[13px] font-bold text-accent font-mono">{pendingApproval.toolName}</code>
                  <span className="text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-red-500/10 text-red-500 border border-red-500/15">{t('chat.toolApproval.dangerous')}</span>
                </div>
                {pendingApproval.reason && (
                  <p className="text-[11px] text-amber-600 dark:text-amber-400 mb-3 leading-relaxed">
                    {pendingApproval.reason}
                  </p>
                )}
                {pendingApproval.args && (
                  <div>
                    <pre className="text-[11px] font-mono text-text-secondary/80 bg-surface border border-border-light/40 rounded-lg p-3 max-h-36 overflow-auto whitespace-pre-wrap leading-relaxed">
                      {JSON.stringify(pendingApproval.args, null, 2)}
                    </pre>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2.5">
                <button onClick={() => { JCode.sendToolApproval(pendingApproval.piSessionId, pendingApproval.requestId, false); setPendingApproval(null) }}
                  className="flex-1 px-4 py-2.5 rounded-xl border border-border-light text-[12px] font-semibold text-text-tertiary hover:text-text hover:bg-surface-secondary/60 transition-all">
                  {t('chat.toolApproval.cancel')}
                </button>
                <button onClick={() => { JCode.sendToolApproval(pendingApproval.piSessionId, pendingApproval.requestId, false); setPendingApproval(null) }}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-surface text-[12px] font-semibold text-red-500 border border-red-500/20 hover:bg-red-500/5 transition-all">
                  {t('chat.toolApproval.reject')}
                </button>
                <button onClick={() => { JCode.sendToolApproval(pendingApproval.piSessionId, pendingApproval.requestId, true); setPendingApproval(null) }}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-accent text-white text-[12px] font-bold shadow-md shadow-accent/20 hover:shadow-lg transition-all">
                  {t('chat.toolApproval.approve')}
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  )
}
