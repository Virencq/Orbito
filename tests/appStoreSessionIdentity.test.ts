// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkspaceStore } from '../src/stores/workspaceStore'

const getAllSessions = vi.fn()
const getMessages = vi.fn(async () => [])
const updateSession = vi.fn(async () => undefined)
const deleteDbSession = vi.fn(async () => undefined)
const deleteJCodeSession = vi.fn(async () => undefined)

vi.mock('../src/utils/database', () => ({
  getAllSessions,
  getMessages,
  createSession: vi.fn(async () => undefined),
  updateSession,
  deleteSession: deleteDbSession,
  saveMessage: vi.fn(async () => undefined),
}))

vi.mock('../src/utils/jcodeClient', () => ({
  deleteSession: deleteJCodeSession,
}))

describe('app store session identity', () => {
  beforeEach(async () => {
    localStorage.clear()
    getAllSessions.mockReset()
    getMessages.mockReset()
    getMessages.mockResolvedValue([])
    updateSession.mockClear()
    deleteDbSession.mockClear()
    deleteJCodeSession.mockClear()

    const { useAppStore } = await import('../src/stores/appStore')
    useAppStore.setState({
      sessions: [],
      activeSessionId: null,
      sessionMessages: {},
      streamingMessage: {},
      codeActiveSessionId: null,
      codeSessionIds: [],
    })
    useWorkspaceStore.setState({
      projects: [],
      codeProjects: [],
      activeCodeProjectId: null,
      artifacts: [],
      pinnedProjectIds: [],
      pinnedArtifactIds: [],
    })
  })

  it('restores the durable UI session identity from SQLite without reusing a stale ACP id', async () => {
    getAllSessions.mockResolvedValueOnce([{
      id: 'ui-session',
      title: 'Existing chat',
      model: 'deepseek-chat',
      pi_id: 'stale-acp-session',
      created_at: 1,
      updated_at: 2,
    }])
    const { useAppStore } = await import('../src/stores/appStore')

    await useAppStore.getState().loadFromDb()

    expect(useAppStore.getState().sessions[0]).toMatchObject({
      id: 'ui-session',
      title: 'Existing chat',
      model: 'deepseek-chat',
      createdAt: 1,
      updatedAt: 2,
    })
    // ACP session identifiers are process-scoped and must not be resumed after restart.
    expect(useAppStore.getState().sessions[0].piId).toBeUndefined()
  })

  it('deduplicates concurrent and repeated history loads, including empty chats', async () => {
    let resolveMessages!: (messages: never[]) => void
    getMessages.mockImplementationOnce(() => new Promise((resolve) => {
      resolveMessages = resolve
    }))
    const { useAppStore } = await import('../src/stores/appStore')

    const first = useAppStore.getState().loadMessages('empty-session')
    const second = useAppStore.getState().loadMessages('empty-session')
    expect(getMessages).toHaveBeenCalledTimes(1)

    resolveMessages([])
    await Promise.all([first, second])
    await useAppStore.getState().loadMessages('empty-session')

    expect(getMessages).toHaveBeenCalledTimes(1)
    expect(useAppStore.getState().sessionMessages['empty-session']).toEqual([])
  })

  it('updates the in-memory and SQLite ACP session id together', async () => {
    const { useAppStore } = await import('../src/stores/appStore')
    useAppStore.setState({
      sessions: [{
        id: 'ui-session', title: 'Chat', model: '', createdAt: 1, updatedAt: 1,
      }],
    })

    useAppStore.getState().setSessionPiId('ui-session', 'acp-session')

    expect(useAppStore.getState().sessions[0].piId).toBe('acp-session')
    expect(updateSession).toHaveBeenCalledWith('ui-session', { pi_id: 'acp-session' })
  })

  it('closes an active ACP session by its runtime id, not the durable UI id', async () => {
    const { useAppStore } = await import('../src/stores/appStore')
    useAppStore.setState({
      sessions: [{
        id: 'ui-session', piId: 'acp-session', title: 'Chat', model: '', createdAt: 1, updatedAt: 1,
      }],
    })

    useAppStore.getState().deleteSession('ui-session')
    await vi.waitFor(() => expect(deleteJCodeSession).toHaveBeenCalled())

    expect(deleteDbSession).toHaveBeenCalledWith('ui-session')
    expect(deleteJCodeSession).toHaveBeenCalledWith('acp-session')
    expect(deleteJCodeSession).not.toHaveBeenCalledWith('ui-session')
  })

  it('unlinks a deleted Code conversation from its project', async () => {
    const { useAppStore } = await import('../src/stores/appStore')
    const projectId = useWorkspaceStore.getState().addCodeProject({
      name: 'Project',
      path: 'C:\\work\\project',
      sessionId: 'code-session',
    })
    useAppStore.setState({
      sessions: [{
        id: 'code-session', title: 'Code chat', model: '', createdAt: 1, updatedAt: 1,
      }],
      activeSessionId: null,
      codeActiveSessionId: 'code-session',
      codeSessionIds: ['code-session'],
    })

    useAppStore.getState().deleteSession('code-session')

    expect(useWorkspaceStore.getState().codeProjects.find((project) => project.id === projectId)?.sessionId).toBeUndefined()
  })

  it('creates Code sessions without changing the active Cowork conversation', async () => {
    const { useAppStore } = await import('../src/stores/appStore')
    useAppStore.setState({
      activeSessionId: 'cowork-session',
      sessions: [{ id: 'cowork-session', title: 'Cowork', model: '', createdAt: 1, updatedAt: 1 }],
    })

    const codeSessionId = useAppStore.getState().createCodeSession()

    expect(useAppStore.getState().activeSessionId).toBe('cowork-session')
    expect(useAppStore.getState().codeActiveSessionId).toBe(codeSessionId)
    expect(useAppStore.getState().codeSessionIds).toContain(codeSessionId)
  })

  it('removes deleted Code sessions from Code-only state without changing Cowork selection', async () => {
    const { useAppStore } = await import('../src/stores/appStore')
    useAppStore.setState({
      sessions: [
        { id: 'cowork-session', title: 'Cowork', model: '', createdAt: 1, updatedAt: 1 },
        { id: 'code-session', title: 'Code', model: '', createdAt: 1, updatedAt: 1 },
      ],
      activeSessionId: 'cowork-session',
      codeActiveSessionId: 'code-session',
      codeSessionIds: ['code-session'],
      sessionMessages: { 'cowork-session': [], 'code-session': [] },
    })

    useAppStore.getState().deleteSession('code-session')

    expect(useAppStore.getState().activeSessionId).toBe('cowork-session')
    expect(useAppStore.getState().codeActiveSessionId).toBeNull()
    expect(useAppStore.getState().codeSessionIds).not.toContain('code-session')
    expect(useAppStore.getState().sessionMessages).not.toHaveProperty('code-session')
  })

  it('does not select a Code conversation when deleting the active Cowork conversation', async () => {
    const { useAppStore } = await import('../src/stores/appStore')
    useAppStore.setState({
      sessions: [
        { id: 'cowork-active', title: 'Cowork active', model: '', createdAt: 1, updatedAt: 1 },
        { id: 'code-session', title: 'Code', model: '', createdAt: 1, updatedAt: 1 },
        { id: 'cowork-next', title: 'Cowork next', model: '', createdAt: 1, updatedAt: 1 },
      ],
      activeSessionId: 'cowork-active',
      codeActiveSessionId: 'code-session',
      codeSessionIds: ['code-session'],
    })

    useAppStore.getState().deleteSession('cowork-active')

    expect(useAppStore.getState().activeSessionId).toBe('cowork-next')
    expect(useAppStore.getState().codeActiveSessionId).toBe('code-session')
  })

  it('reconciles persisted Code sessions against SQLite and clears orphaned project links', async () => {
    getAllSessions.mockResolvedValueOnce([
      { id: 'cowork-session', title: 'Cowork', model: '', created_at: 1, updated_at: 1 },
      { id: 'valid-code-session', title: 'Code', model: '', created_at: 2, updated_at: 2 },
    ])
    const validProjectId = useWorkspaceStore.getState().addCodeProject({
      name: 'Valid project',
      path: 'C:\\work\\valid',
      sessionId: 'valid-code-session',
    })
    const staleProjectId = useWorkspaceStore.getState().addCodeProject({
      name: 'Stale project',
      path: 'C:\\work\\stale',
      sessionId: 'missing-session',
    })
    const { useAppStore } = await import('../src/stores/appStore')
    useAppStore.setState({
      codeActiveSessionId: 'valid-code-session',
      codeSessionIds: ['valid-code-session', 'missing-session'],
    })
    useWorkspaceStore.getState().setActiveCodeProject(validProjectId)

    await useAppStore.getState().loadFromDb()

    const state = useAppStore.getState()
    expect(state.codeSessionIds).toEqual(['valid-code-session'])
    expect(state.codeActiveSessionId).toBe('valid-code-session')
    expect(useWorkspaceStore.getState().codeProjects.find((project) => project.id === staleProjectId)?.sessionId).toBeUndefined()
  })

  it('starts a new Code chat without inheriting the active project', async () => {
    const { useAppStore } = await import('../src/stores/appStore')
    const projectId = useWorkspaceStore.getState().addCodeProject({
      name: 'Previously active project',
      path: 'C:\\work\\active',
    })
    useWorkspaceStore.getState().setActiveCodeProject(projectId)

    const sessionId = useAppStore.getState().createCodeSession()

    expect(useWorkspaceStore.getState().activeCodeProjectId).toBeNull()
    expect(useWorkspaceStore.getState().codeProjects.find((project) => project.id === projectId)?.sessionId).toBeUndefined()
    expect(useAppStore.getState().codeActiveSessionId).toBe(sessionId)
  })

  it('starts a new Cowork chat without inheriting the active folder project', async () => {
    const { useAppStore } = await import('../src/stores/appStore')
    const projectId = useWorkspaceStore.getState().addProject({
      name: 'Previously active project',
      path: 'C:\\work\\cowork',
    })
    useAppStore.setState({ workspaceDir: 'C:\\work\\cowork' })

    const sessionId = useAppStore.getState().createSession()

    expect(useWorkspaceStore.getState().projects.find((project) => project.id === projectId)?.sessionId).toBeUndefined()
    expect(useWorkspaceStore.getState().projects.find((project) => project.id === projectId)?.sessionIds).toBeUndefined()
    expect(useAppStore.getState().activeSessionId).toBe(sessionId)
  })

  it('clears project session links when all conversations are cleared', async () => {
    const { useAppStore } = await import('../src/stores/appStore')
    const coworkProjectId = useWorkspaceStore.getState().addProject({
      name: 'Cowork project',
      path: '/work/cowork',
      sessionId: 'cowork-session',
    })
    const codeProjectId = useWorkspaceStore.getState().addCodeProject({
      name: 'Code project',
      path: 'C:\\work\\code',
      sessionId: 'code-session',
    })
    useAppStore.setState({
      sessions: [
        { id: 'cowork-session', title: 'Cowork', model: '', createdAt: 1, updatedAt: 1 },
        { id: 'code-session', title: 'Code', model: '', createdAt: 1, updatedAt: 1 },
      ],
      activeSessionId: 'cowork-session',
      codeActiveSessionId: 'code-session',
      codeSessionIds: ['code-session'],
    })

    useAppStore.getState().clearSessions()

    expect(useAppStore.getState().codeSessionIds).toEqual([])
    expect(useAppStore.getState().codeActiveSessionId).toBeNull()
    expect(useWorkspaceStore.getState().projects.find((project) => project.id === coworkProjectId)?.sessionId).toBeUndefined()
    expect(useWorkspaceStore.getState().codeProjects.find((project) => project.id === codeProjectId)?.sessionId).toBeUndefined()
  })
})
