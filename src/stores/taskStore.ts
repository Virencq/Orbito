import { create } from 'zustand'
import type { ScheduledTask, TaskExecution, TaskSchedule, TaskDelivery, TaskAgentRuntime } from '../types/task'
import { nextScheduledRunAt } from '../types/task'
import type { KiloMessage } from '../types'
import * as JCode from '../utils/jcodeClient'
import { useAppStore } from './appStore'

const STORAGE_KEY = 'cowork-scheduled-tasks-v1'
const OUTPUT_KEY = 'cowork-scheduled-task-outputs-v1'

type CreateTaskInput = {
  name: string
  prompt: string
  schedule: TaskSchedule
  skills?: string[]
  agentRuntime?: TaskAgentRuntime
  contextFrom?: string[]
  model?: string
  provider?: string
  workspaceDir?: string
  deliver?: TaskDelivery
  deliverSessionId?: string
  enabled?: boolean
}

type TaskOutput = {
  timestamp: string
  content: string
  file?: string
}

interface TaskState {
  tasks: ScheduledTask[]
  outputs: Record<string, TaskOutput[]>
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  tick: () => Promise<void>
  createTask: (data: CreateTaskInput) => Promise<ScheduledTask | null>
  removeTask: (id: string) => Promise<void>
  toggleTask: (id: string) => Promise<void>
  triggerRun: (id: string) => Promise<void>
  fetchOutput: (id: string) => Promise<TaskOutput[]>
}

function loadTasks(): ScheduledTask[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function loadOutputs(): Record<string, TaskOutput[]> {
  try {
    const raw = localStorage.getItem(OUTPUT_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function save(tasks: ScheduledTask[], outputs: Record<string, TaskOutput[]>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks))
  localStorage.setItem(OUTPUT_KEY, JSON.stringify(outputs))
}

function nextRun(task: ScheduledTask, from = Date.now()) {
  return nextScheduledRunAt(task.schedule, from)
}

function runtimePrompt(task: ScheduledTask, context: string[] = []) {
  return [
    task.agentRuntime?.agentSystemPrompt,
    task.agentRuntime?.agentSkillsBlock,
    context.length ? `## Previous scheduled task output\n${context.join('\n\n')}\n\nUse this only as task context; do not repeat it unless relevant.` : '',
    task.prompt,
  ].filter((part) => part?.trim()).join('\n\n')
}

async function executeTask(task: ScheduledTask, context: string[] = []): Promise<string> {
  const session = await JCode.createSession(task.workspaceDir)
  let output = ''
  const unsubscribe = await JCode.subscribeStream(session.id, {
    onText: (_partId, delta) => { output += delta },
  })

  try {
    const result = await JCode.prompt(session.id, runtimePrompt(task, context), {
      workspaceDir: task.workspaceDir,
      workspaceRoots: task.agentRuntime?.workspaceRoots,
      permissionMode: task.agentRuntime?.permissionMode,
      permissionRules: task.agentRuntime?.permissionRules,
    })
    if (result.error) throw new Error(result.error)
    return output || result.text || ''
  } finally {
    unsubscribe()
    await JCode.deleteSession(session.id).catch(() => {})
  }
}

function deliverToChat(task: ScheduledTask, content: string) {
  const store = useAppStore.getState()
  let sessionId = task.deliverSessionId
  if (!sessionId || !store.sessions.some((session) => session.id === sessionId)) {
    sessionId = store.createSession()
  }
  const now = Date.now()
  const messageId = `task-${task.id}-${now}`
  const message: KiloMessage = {
    info: { id: messageId, sessionID: sessionId, role: 'assistant', time: { created: now, completed: now } },
    parts: [{
      id: `${messageId}-text`,
      type: 'text',
      text: content,
      sessionID: sessionId,
      messageID: messageId,
      time: { created: now, completed: now },
    }],
  }
  store.addMessage(sessionId, message)
  return sessionId
}

export const useTaskStore = create<TaskState>()((set, get) => {
  const persist = (tasks: ScheduledTask[], outputs: Record<string, TaskOutput[]>) => {
    set({ tasks, outputs })
    save(tasks, outputs)
  }

  return {
    tasks: loadTasks(),
    outputs: loadOutputs(),
    loading: false,
    error: null,

    refresh: async () => {
      set({ loading: true, error: null })
      try {
        const tasks = loadTasks()
        const outputs = loadOutputs()
        set({ tasks, outputs, loading: false })
      } catch (error) {
        set({ error: error instanceof Error ? error.message : String(error), loading: false })
      }
    },

    tick: async () => {
      const tasks = get().tasks
      const now = Date.now()
      const due = tasks.filter((task) =>
        task.enabled &&
        task.nextRunAt !== null &&
        task.nextRunAt <= now &&
        task.lastStatus !== 'running'
      )
      for (const task of due) {
        await get().triggerRun(task.id)
      }
    },

    createTask: async (data) => {
      const now = Date.now()
      const task: ScheduledTask = {
        id: crypto.randomUUID(),
        name: data.name.trim() || 'Scheduled task',
        prompt: data.prompt.trim(),
        schedule: data.schedule,
        skills: data.skills || [],
        agentRuntime: data.agentRuntime,
        contextFrom: data.contextFrom || [],
        model: data.model,
        provider: data.provider,
        workspaceDir: data.workspaceDir,
        deliver: data.deliver || 'chat',
        deliverSessionId: data.deliverSessionId,
        enabled: data.enabled ?? true,
        nextRunAt: nextScheduledRunAt(data.schedule, now),
        lastRunAt: null,
        lastStartedAt: null,
        lastFinishedAt: null,
        lastStatus: 'pending',
        createdAt: now,
      }
      persist([...get().tasks, task], get().outputs)
      return task
    },

    removeTask: async (id) => {
      const tasks = get().tasks.filter((task) => task.id !== id)
      const outputs = { ...get().outputs }
      delete outputs[id]
      persist(tasks, outputs)
    },

    toggleTask: async (id) => {
      const tasks = get().tasks.map((task) => {
        if (task.id !== id) return task
        const enabled = !task.enabled
        return {
          ...task,
          enabled,
          lastStatus: enabled ? task.lastStatus : 'cancelled',
          nextRunAt: enabled ? nextRun(task, Date.now()) : null,
        }
      })
      persist(tasks, get().outputs)
    },

    triggerRun: async (id) => {
      const current = get().tasks.find((task) => task.id === id)
      if (!current || current.lastStatus === 'running') return

      const started = Date.now()
      let tasks = get().tasks.map((task) =>
        task.id === id
          ? { ...task, lastStatus: 'running' as const, lastStartedAt: started, lastTrigger: 'manual' as const, lastRunAt: started }
          : task
      )
      persist(tasks, get().outputs)

      try {
        if (current.deliver !== 'chat' && current.deliver !== 'silent') {
          throw new Error('External platform delivery is not connected to the JCode-only runtime yet. Use Chat or Silent delivery.')
        }
        const context = (current.contextFrom || [])
          .flatMap((taskId) => get().outputs[taskId] || [])
          .slice(0, 10)
          .map((output) => output.content)
        const content = await executeTask(current, context)
        const finished = Date.now()
        const output: TaskOutput = { timestamp: new Date(finished).toISOString(), content: content || '(JCode completed without text output.)' }
        const outputs = { ...get().outputs, [id]: [output, ...(get().outputs[id] || [])].slice(0, 20) }

        tasks = get().tasks.map((task) => {
          if (task.id !== id) return task
          const repeatCompleted = (task.repeat?.completed || 0) + 1
          const reachedLimit = task.repeat?.times != null && repeatCompleted >= task.repeat.times
          const next = reachedLimit || task.schedule.kind === 'once' ? null : nextRun(task, finished)
          return {
            ...task,
            lastStatus: 'completed' as const,
            lastFinishedAt: finished,
            lastRunId: `run-${finished}`,
            nextRunAt: next,
            enabled: reachedLimit || task.schedule.kind === 'once' ? false : task.enabled,
            repeat: task.repeat ? { ...task.repeat, completed: repeatCompleted } : task.repeat,
          }
        })

        const liveTask = tasks.find((task) => task.id === id)
        if (liveTask?.deliver === 'chat' && content) {
          const sessionId = deliverToChat(liveTask, content)
          tasks = tasks.map((task) => task.id === id ? { ...task, deliverSessionId: sessionId } : task)
        }

        persist(tasks, outputs)
      } catch (error) {
        const finished = Date.now()
        tasks = get().tasks.map((task) =>
          task.id === id
            ? { ...task, lastStatus: 'failed' as const, lastFinishedAt: finished, lastError: error instanceof Error ? error.message : String(error), nextRunAt: task.schedule.kind === 'once' ? null : nextRun(task, finished) }
            : task
        )
        persist(tasks, get().outputs)
      }
    },

    fetchOutput: async (id) => get().outputs[id] || [],
  }
})
