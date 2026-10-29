import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { useWorkspaceStore } from './workspaceStore'
import i18n from '../i18n'
import type { Session, ProviderConfig, Companion, ProviderInfo, KiloMessage, MessagePart, MessageInfo } from '../types'
import * as db from '../utils/database'
import { enrichSession } from '../utils/sessionMeta'
import { DEFAULT_COLOR_SCHEME } from '../themes'
import {
  DEFAULT_KOKORO_SPEAKER_ID,
  normalizeKokoroSpeakerId,
  type KokoroSpeakerId,
} from '../config/kokoroVoices'
// Coalesce rapid persist writes (notably streaming token updates) into one
// localStorage write every 500 ms. SQLite remains authoritative for messages.
let persistWriteTimer: ReturnType<typeof setTimeout> | undefined
const debouncedLocalStorage = {
  getItem: (name: string) => localStorage.getItem(name),
  setItem: (name: string, value: string) => {
    if (persistWriteTimer !== undefined) clearTimeout(persistWriteTimer)
    persistWriteTimer = setTimeout(() => {
      try {
        localStorage.setItem(name, value)
      } catch (error) {
        console.warn('[Orbito] Could not persist local state:', error)
      }
    }, 500)
  },
  removeItem: (name: string) => {
    if (persistWriteTimer !== undefined) {
      clearTimeout(persistWriteTimer)
      persistWriteTimer = undefined
    }
    localStorage.removeItem(name)
  },
}

import {
  loadProviderApiKey,
  redactProviderConfigs,
  saveProviderApiKey,
} from '../utils/credentialVault'

interface AppState {
  // Sessions (cached from DB)
  sessions: Session[]
  activeSessionId: string | null
  sessionMessages: Record<string, KiloMessage[]>

  // Streaming state
  streamingMessage: Record<string, {
    messageID: string
    parts: MessagePart[]
    isStreaming: boolean
    info?: MessageInfo
  }>

  // Provider �?now dynamic (any OpenCode provider ID)
  activeProvider: string
  providerConfigs: Record<string, ProviderConfig>
  providerList: ProviderInfo[]
  customProviders: ProviderInfo[]

  // UI
  theme: 'light' | 'dark'
  colorScheme: string
  locale: string
  sidebarCollapsed: boolean
  leftPanelMode: 'sessions' | 'files'
  workspaceCollapsed: boolean
  workspaceDir: string | null
  codeWorkspaceDir: string | null
  codeActiveSessionId: string | null
  codeSessionIds: string[]
  fileTreeVersion: number
  kokoroSpeakerId: KokoroSpeakerId
  handsfreeEnabled: boolean

  // Skill mirror config
  githubMirror: string
  npmRegistryMirror: string

  // Companion (pet)
  companion: Companion | null

  // Actions - Database
  loadFromDb: () => Promise<void>
  loadMessages: (sessionId: string) => Promise<void>

  // Actions - Sessions
  createSession: () => string
  createCodeSession: () => string
  deleteSession: (id: string) => void
  deleteMessage: (sessionId: string, messageId: string) => void
  deleteMessagesFrom: (sessionId: string, messageId: string) => void
  setActiveSession: (id: string | null) => void
  updateSessionTitle: (id: string, title: string) => void
  setSessionPiId: (id: string, piId: string) => void
  clearSessions: () => void

  // Actions - Messages
  addMessage: (sessionId: string, message: KiloMessage) => void

  // Actions - Streaming
  startStreaming: (sessionId: string, messageID: string) => void
  updateStreamingPart: (sessionId: string, partID: string, part: MessagePart) => void
  appendStreamingDelta: (sessionId: string, partID: string, delta: string) => void
  finishStreaming: (sessionId: string) => void
  commitStreamingMessage: (sessionId: string, message: KiloMessage) => void

  // Actions - Provider
  setActiveProvider: (id: string) => void
  setProviderConfig: (id: string, config: Partial<ProviderConfig>) => void
  hydrateProviderSecrets: () => Promise<void>
  setProviderList: (list: ProviderInfo[]) => void
  addCustomProvider: (provider: ProviderInfo) => void
  updateCustomProvider: (id: string, updates: Partial<ProviderInfo>) => void
  removeCustomProvider: (id: string) => void

  // Actions - UI
  setTheme: (theme: 'light' | 'dark') => void
  setColorScheme: (scheme: string) => void
  setLocale: (locale: string) => void
  setGithubMirror: (url: string) => void
  setNpmRegistryMirror: (url: string) => void
  toggleSidebar: () => void
  setLeftPanelMode: (mode: 'sessions' | 'files') => void
  toggleLeftPanelMode: () => void
  toggleWorkspace: () => void
  setWorkspaceDir: (dir: string | null) => void
  setCodeWorkspaceDir: (dir: string | null) => void
  setCodeActiveSessionId: (id: string | null) => void
  markCodeSession: (id: string) => void
  incrementFileTreeVersion: () => void
  setKokoroSpeakerId: (speakerId: KokoroSpeakerId) => void
  setHandsfreeEnabled: (enabled: boolean) => void

  // Actions - Companion
  setCompanion: (companion: Companion | null) => void
}

const DEFAULT_CONFIGS: Record<string, ProviderConfig> = {
  anthropic: { apiKey: '', model: '', baseUrl: '' },
  openai: { apiKey: '', model: '', baseUrl: '' },
}

function mergeProviderList(currentList: ProviderInfo[], customProviders: ProviderInfo[]) {
  const customIds = new Set(customProviders.map((p) => p.id))
  const builtIn = currentList.filter((p) => !customIds.has(p.id))
  return [...builtIn, ...customProviders]
}

const generateId = () => Math.random().toString(36).substring(2, 15)

// Avoid duplicate SQLite reads when sidebar/project actions and component effects
// request the same session at nearly the same time. Empty histories are cached too.
const messageLoadsInFlight = new Map<string, Promise<void>>()
const loadedMessageSessions = new Set<string>()

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      sessions: [],
      activeSessionId: null,
      sessionMessages: {},
      streamingMessage: {},

      activeProvider: 'anthropic',
      providerConfigs: DEFAULT_CONFIGS,
      providerList: [],
      customProviders: [],

      theme: 'light',
      colorScheme: DEFAULT_COLOR_SCHEME,
      locale: i18n.language?.startsWith('zh') ? 'zh' : 'en',
      sidebarCollapsed: false,
      leftPanelMode: 'sessions',
      workspaceCollapsed: false,
      workspaceDir: null,
      codeWorkspaceDir: null,
      codeActiveSessionId: null,
      codeSessionIds: [],
      fileTreeVersion: 0,
      kokoroSpeakerId: DEFAULT_KOKORO_SPEAKER_ID,
      handsfreeEnabled: false,
      githubMirror: '',
      npmRegistryMirror: 'https://registry.npmmirror.com',
      companion: null,

      // ---- Database actions ----

      loadFromDb: async () => {
        try {
          const rows = await db.getAllSessions()
          const sessions: Session[] = rows.map(r => enrichSession({
            id: r.id,
            title: r.title,
            model: r.model,
            // ACP session IDs belong to the child JCode process and are invalid after restart.
            piId: undefined,
            createdAt: r.created_at,
            updatedAt: r.updated_at,
          }))
          const validSessionIds = new Set(sessions.map((session) => session.id))
          const state = get()
          const workspace = useWorkspaceStore.getState()
          const staleCodeProjects = workspace.codeProjects.filter(
            (project) => project.sessionId && !validSessionIds.has(project.sessionId),
          )
          for (const project of staleCodeProjects) {
            workspace.updateCodeProject(project.id, { sessionId: undefined })
          }
          const projectCodeSessionIds = workspace.codeProjects.flatMap(
            (project) => project.sessionId && validSessionIds.has(project.sessionId) ? [project.sessionId] : [],
          )
          const codeSessionIds = [...new Set([
            ...state.codeSessionIds.filter((sessionId) => validSessionIds.has(sessionId)),
            ...projectCodeSessionIds,
          ])]
          const activeProject = workspace.codeProjects.find((project) => project.id === workspace.activeCodeProjectId)
          const preferredCodeSessionId = activeProject?.sessionId ?? state.codeActiveSessionId
          const codeActiveSessionId = preferredCodeSessionId && validSessionIds.has(preferredCodeSessionId)
            ? preferredCodeSessionId
            : null
          set({ sessions, codeSessionIds, codeActiveSessionId })
        } catch (err) {
          console.warn('[appStore] loadFromDb failed:', err)
        }
      },

      loadMessages: async (sessionId: string) => {
        if (loadedMessageSessions.has(sessionId)) return
        const existingLoad = messageLoadsInFlight.get(sessionId)
        if (existingLoad) return existingLoad

        // If the session was edited while its initial read was pending, don't let
        // the older database snapshot overwrite the newer in-memory conversation.
        const initialMessages = get().sessionMessages[sessionId]
        const load = (async () => {
          try {
            const messages = await db.getMessages(sessionId)
            const currentMessages = get().sessionMessages[sessionId]
            if (currentMessages === initialMessages) {
              set((state) => ({
                sessionMessages: { ...state.sessionMessages, [sessionId]: messages },
              }))
            }
            loadedMessageSessions.add(sessionId)
          } catch (err) {
            console.warn('[appStore] loadMessages failed:', err)
          } finally {
            messageLoadsInFlight.delete(sessionId)
          }
        })()
        messageLoadsInFlight.set(sessionId, load)
        return load
      },

      // ---- Session actions ----

      createSession: () => {
        const id = generateId()
        const now = Date.now()
        const session: Session = enrichSession({ id, title: 'New Chat', model: '', createdAt: now, updatedAt: now })
        set((state) => ({
          sessions: [...state.sessions, session],
          activeSessionId: id,
          sessionMessages: { ...state.sessionMessages, [id]: [] },
        }))
        // Persist the conversation-to-project relationship for every chat created
        // while a Cowork project folder is active, not only the first chat.
        const activeWorkspaceDir = get().workspaceDir
        if (activeWorkspaceDir) {
          const normalizePath = (value: string) => value.split(String.fromCharCode(92)).join('/').replace(/\/+$/, '').toLowerCase()
          const project = useWorkspaceStore.getState().projects.find(
            (item) => item.path && normalizePath(item.path) === normalizePath(activeWorkspaceDir),
          )
          if (project) {
            const sessionIds = [...new Set([...(project.sessionIds || []), ...(project.sessionId ? [project.sessionId] : []), id])]
            useWorkspaceStore.getState().updateProject(project.id, { sessionId: project.sessionId || id, sessionIds })
          }
        }
        db.createSession(id, 'New Chat').catch(console.warn)
        return id
      },

      createCodeSession: () => {
        const id = generateId()
        const now = Date.now()
        const session: Session = enrichSession({ id, title: 'New Chat', model: '', createdAt: now, updatedAt: now })
        set((state) => ({
          sessions: [...state.sessions, session],
          codeActiveSessionId: id,
          codeSessionIds: state.codeSessionIds.includes(id) ? state.codeSessionIds : [...state.codeSessionIds, id],
          sessionMessages: { ...state.sessionMessages, [id]: [] },
        }))
        // Keep the active project's durable session link synchronized even when
        // ChatView has to create a session itself (e.g. after clearing history).
        const workspace = useWorkspaceStore.getState()
        const activeProject = workspace.codeProjects.find(
          (project) => project.id === workspace.activeCodeProjectId,
        )
        if (activeProject && !activeProject.sessionId) {
          workspace.updateCodeProject(activeProject.id, { sessionId: id })
        }
        db.createSession(id, 'New Chat').catch(console.warn)
        return id
      },

      deleteSession: (id) => {
        const state = get()
        const piId = state.sessions.find((session) => session.id === id)?.piId
        // A Code project must never keep pointing at a conversation that was
        // deleted independently from the project itself.
        const workspace = useWorkspaceStore.getState()
        const projectSessionIds = workspace.codeProjects.flatMap((project) => project.sessionId ? [project.sessionId] : [])
        const codeSessionIds = new Set([...state.codeSessionIds, ...projectSessionIds])
        for (const project of workspace.codeProjects) {
          if (project.sessionId === id) {
            workspace.updateCodeProject(project.id, { sessionId: undefined })
          }
        }
        const remainingSessions = state.sessions.filter((session) => session.id !== id)
        const nextCoworkSession = remainingSessions.find((session) => !codeSessionIds.has(session.id))
        set({
          sessions: remainingSessions,
          activeSessionId: state.activeSessionId === id
            ? (nextCoworkSession?.id ?? null)
            : state.activeSessionId,
          codeActiveSessionId: state.codeActiveSessionId === id ? null : state.codeActiveSessionId,
          codeSessionIds: state.codeSessionIds.filter((sessionId) => sessionId !== id),
          sessionMessages: Object.fromEntries(
            Object.entries(state.sessionMessages).filter(([k]) => k !== id)
          ),
          streamingMessage: Object.fromEntries(
            Object.entries(state.streamingMessage).filter(([k]) => k !== id)
          ),
        })
        db.deleteSession(id).catch(console.warn)
        // Also delete the session file from disk (pi-server)
        if (piId) {
          import('../utils/jcodeClient').then((pi) => pi.deleteSession(piId).catch(() => {}))
        }
      },

      deleteMessage: (sessionId, messageId) => {
        set((state) => ({
          sessionMessages: {
            ...state.sessionMessages,
            [sessionId]: (state.sessionMessages[sessionId] || []).filter((message) => message.info.id !== messageId),
          },
        }))
        db.deleteMessage(messageId).catch(console.warn)
      },

      deleteMessagesFrom: (sessionId, messageId) => {
        const current = get().sessionMessages[sessionId] || []
        const index = current.findIndex((message) => message.info.id === messageId)
        if (index < 0) return
        const removed = current.slice(index)
        set((state) => ({
          sessionMessages: {
            ...state.sessionMessages,
            [sessionId]: current.slice(0, index),
          },
        }))
        db.deleteMessagesByIds(removed.map((message) => message.info.id)).catch(console.warn)
      },

      setActiveSession: (id) => {
        set({ activeSessionId: id })
        if (id) {
          const existing = get().sessionMessages[id]
          if (!existing || existing.length === 0) {
            get().loadMessages(id).catch(console.warn)
          }
        }
      },

      updateSessionTitle: (id, title) => {
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === id ? { ...s, title, updatedAt: Date.now() } : s,
          ),
        }))
        db.updateSession(id, { title }).catch(console.warn)
      },

      setSessionPiId: (id, piId) => {
        set((state) => ({
          sessions: state.sessions.map((session) =>
            session.id === id
              ? { ...session, piId, updatedAt: Date.now() }
              : session,
          ),
        }))
        db.updateSession(id, { pi_id: piId }).catch(console.warn)
      },

      clearSessions: () => {
        const sessions = get().sessions.map(({ id, piId }) => ({ id, piId }))
        const workspace = useWorkspaceStore.getState()
        for (const project of workspace.projects) {
          if (project.sessionId) workspace.updateProject(project.id, { sessionId: undefined })
        }
        for (const project of workspace.codeProjects) {
          if (project.sessionId) workspace.updateCodeProject(project.id, { sessionId: undefined })
        }
        set({
          sessions: [],
          activeSessionId: null,
          codeActiveSessionId: null,
          codeSessionIds: [],
          sessionMessages: {},
          streamingMessage: {},
        })
        Promise.all(sessions.map(({ id }) => db.deleteSession(id))).catch(console.warn)
        // Also delete session files from disk
        const piIds = sessions.flatMap(({ piId }) => piId ? [piId] : [])
        if (piIds.length > 0) {
          import('../utils/jcodeClient').then((pi) =>
            Promise.all(piIds.map((piId) => pi.deleteSession(piId).catch(() => {}))).catch(() => {}),
          )
        }
      },

      // ---- Message actions ----

      addMessage: (sessionId, message) => {
        set((state) => ({
          sessionMessages: {
            ...state.sessionMessages,
            [sessionId]: [...(state.sessionMessages[sessionId] || []), message],
          },
        }))
        db.saveMessage(
          message.info.id,
          sessionId,
          message.info.role,
          message.parts,
          message.info as unknown as Record<string, unknown>,
        ).catch(console.warn)
      },

      startStreaming: (sessionId, messageID) => {
        set((state) => ({
          streamingMessage: {
            ...state.streamingMessage,
            [sessionId]: { messageID, parts: [], isStreaming: true },
          },
        }))
      },

      updateStreamingPart: (sessionId, partID, part) => {
        set((state) => {
          const streaming = state.streamingMessage[sessionId]
          if (!streaming) return state

          if (!streaming.messageID.startsWith('pending-') && part.messageID !== streaming.messageID) {
            return state
          }

          const parts = [...streaming.parts]
          const idx = parts.findIndex((p) => p.id === partID)
          if (idx >= 0) {
            const existing = parts[idx]
            if (
              (existing.type === 'text' || existing.type === 'reasoning') &&
              (part.type === 'text' || part.type === 'reasoning') &&
              existing.text.length > (part.text?.length ?? 0)
            ) {
              parts[idx] = { ...part, text: existing.text }
            } else {
              parts[idx] = part
            }
          } else {
            parts.push(part)
          }
          return {
            streamingMessage: {
              ...state.streamingMessage,
              [sessionId]: { ...streaming, parts },
            },
          }
        })
      },

      appendStreamingDelta: (sessionId, partID, delta) => {
        set((state) => {
          const streaming = state.streamingMessage[sessionId]
          if (!streaming) return state

          const idx = streaming.parts.findIndex((p) => p.id === partID)
          let parts = [...streaming.parts]

          if (idx === -1) {
            parts.push({
              id: partID,
              type: 'text',
              text: delta,
              sessionID: streaming.info?.sessionID || sessionId,
              messageID: streaming.messageID,
            })
          } else {
            parts = streaming.parts.map((p) => {
              if (p.id !== partID) return p
              if (p.type === 'text' || p.type === 'reasoning') {
                return { ...p, text: p.text + delta }
              }
              return p
            })
          }

          return {
            streamingMessage: {
              ...state.streamingMessage,
              [sessionId]: { ...streaming, parts },
            },
          }
        })
      },

      finishStreaming: (sessionId) => {
        const state = get()
        const streaming = state.streamingMessage[sessionId]
        if (!streaming) return

        const info = streaming.info || {
          id: streaming.messageID,
          sessionID: sessionId,
          role: 'assistant' as const,
          time: { created: Date.now(), completed: Date.now() },
        }

        const newMessage: KiloMessage = {
          info,
          parts: streaming.parts,
        }

        const updated = { ...state.streamingMessage }
        delete updated[sessionId]

        set({
          sessionMessages: {
            ...state.sessionMessages,
            [sessionId]: [...(state.sessionMessages[sessionId] || []), newMessage],
          },
          streamingMessage: updated,
        })
        db.saveMessage(
          newMessage.info.id,
          sessionId,
          newMessage.info.role,
          newMessage.parts,
          newMessage.info as unknown as Record<string, unknown>,
        ).catch(console.warn)
      },

      commitStreamingMessage: (sessionId, message) => {
        set((state) => {
          const updatedStreaming = { ...state.streamingMessage }
          delete updatedStreaming[sessionId]

          const existingMessages = state.sessionMessages[sessionId] || []
          const existingIndex = existingMessages.findIndex((msg) => msg.info.id === message.info.id)
          const nextMessages =
            existingIndex >= 0
              ? existingMessages.map((msg, index) => (index === existingIndex ? message : msg))
              : [...existingMessages, message]

          return {
            sessionMessages: {
              ...state.sessionMessages,
              [sessionId]: nextMessages,
            },
            streamingMessage: updatedStreaming,
          }
        })
        db.saveMessage(
          message.info.id,
          sessionId,
          message.info.role,
          message.parts,
          message.info as unknown as Record<string, unknown>,
        ).catch(console.warn)
      },

      // ---- Provider actions ----

      setActiveProvider: (id) => set({ activeProvider: id }),

      setProviderConfig: (id, config) => {
        set((state) => ({
          providerConfigs: {
            ...state.providerConfigs,
            [id]: { ...(state.providerConfigs[id] || { apiKey: '', model: '', baseUrl: '', supportsVision: false }), ...config },
          },
        }))
        if (Object.prototype.hasOwnProperty.call(config, 'apiKey')) {
          saveProviderApiKey(id, config.apiKey || '').catch((error) => {
            console.warn(`[provider] Unable to protect API key for "${id}":`, error)
          })
        }
      },

      hydrateProviderSecrets: async () => {
        const current = get().providerConfigs
        const hydrated = { ...current }
        await Promise.all(Object.entries(current).map(async ([id, config]) => {
          try {
            const protectedKey = await loadProviderApiKey(id)
            if (protectedKey) {
              hydrated[id] = { ...config, apiKey: protectedKey }
            } else if (config.apiKey) {
              // One-time migration from legacy localStorage plaintext.
              await saveProviderApiKey(id, config.apiKey)
            }
          } catch (error) {
            console.warn(`[provider] Unable to load protected API key for "${id}":`, error)
          }
        }))
        set({ providerConfigs: hydrated })
      },

      setProviderList: (list) => set((state) => ({ providerList: mergeProviderList(list, state.customProviders) })),

      addCustomProvider: (provider) => {
        set((state) => {
          if (state.customProviders.some((p) => p.id === provider.id)) return state
          const custom = [...state.customProviders, provider]
          return { customProviders: custom, providerList: mergeProviderList(state.providerList, custom) }
        })
      },

      updateCustomProvider: (id, updates) => {
        set((state) => {
          const custom = state.customProviders.map((p) => (p.id === id ? { ...p, ...updates } : p))
          return { customProviders: custom, providerList: mergeProviderList(state.providerList, custom) }
        })
      },

      removeCustomProvider: (id) => {
        set((state) => {
          const custom = state.customProviders.filter((p) => p.id !== id)
          return { customProviders: custom, providerList: mergeProviderList(state.providerList, custom) }
        })
      },

      // ---- UI actions ----

      setTheme: (theme) => {
        set({ theme })
        document.documentElement.classList.toggle('dark', theme === 'dark')
      },

      setColorScheme: (scheme) => set({ colorScheme: scheme }),

      setLocale: (locale) => {
        set({ locale })
        i18n.changeLanguage(locale)
      },

      setGithubMirror: (url) => set({ githubMirror: url }),
      setNpmRegistryMirror: (url) => set({ npmRegistryMirror: url }),

      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setLeftPanelMode: (mode) => set({ leftPanelMode: mode }),
      toggleLeftPanelMode: () => set((state) => ({
        leftPanelMode: state.leftPanelMode === 'sessions' ? 'files' : 'sessions',
      })),
      toggleWorkspace: () => set((state) => ({ workspaceCollapsed: !state.workspaceCollapsed })),
      setWorkspaceDir: (dir) => set({ workspaceDir: dir }),
      setCodeWorkspaceDir: (dir) => set({ codeWorkspaceDir: dir }),
      setCodeActiveSessionId: (id) => set({ codeActiveSessionId: id }),
      markCodeSession: (id) => set((state) => ({ codeSessionIds: state.codeSessionIds.includes(id) ? state.codeSessionIds : [...state.codeSessionIds, id] })),
      incrementFileTreeVersion: () => set((state) => ({ fileTreeVersion: state.fileTreeVersion + 1 })),
      setKokoroSpeakerId: (speakerId) => set({
        kokoroSpeakerId: normalizeKokoroSpeakerId(speakerId),
      }),
      setHandsfreeEnabled: (enabled) => set({ handsfreeEnabled: enabled }),

      // ---- Companion actions ----

      setCompanion: (companion) => set({ companion }),
    }),
    {
      name: 'snotra-storage',
      storage: createJSONStorage(() => debouncedLocalStorage),
      partialize: (state) => ({
        sessions: state.sessions,
        activeProvider: state.activeProvider,
        providerConfigs: redactProviderConfigs(state.providerConfigs),
        customProviders: state.customProviders,
        theme: state.theme,
        colorScheme: state.colorScheme,
        locale: state.locale,
        companion: state.companion,
        leftPanelMode: state.leftPanelMode,
        workspaceDir: state.workspaceDir,
        codeWorkspaceDir: state.codeWorkspaceDir,
        codeActiveSessionId: state.codeActiveSessionId,
        codeSessionIds: state.codeSessionIds,
        githubMirror: state.githubMirror,
        npmRegistryMirror: state.npmRegistryMirror,
        kokoroSpeakerId: state.kokoroSpeakerId,
        handsfreeEnabled: state.handsfreeEnabled,
      }),
      version: 6,
      migrate: (persistedState, version) => {
        let nextState = persistedState as any
        if (version < 4) {
          nextState = {
            ...nextState,
            sessions: [],
            sessionMessages: {},
            streamingMessage: {},
          }
        }
        if (version < 5) {
          // Messages are loaded from SQLite; do not keep full chat history in localStorage.
          nextState = {
            ...nextState,
            sessionMessages: {},
          }
        }
        if (version < 6) {
          nextState = {
            ...nextState,
            kokoroSpeakerId: normalizeKokoroSpeakerId(nextState.kokoroSpeakerId),
          }
        }
        return nextState
      },
    },
  ),
)
