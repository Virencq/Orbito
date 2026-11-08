import { useAgentStore } from '../stores/agentStore'
import { useAppStore } from '../stores/appStore'
import { useSkillStore } from '../stores/skillStore'
import type { Agent, AgentMCPTool, WorkspaceRoot } from '../types/agent'
import type { SkillInfo } from '../types/skill'
import type { TaskAgentRuntime } from '../types/task'
import { assembleAgentSystemPrompt } from './agentPrompt'

/**
 * Runtime config derived from the active agent, synced to the backend so
 * that autonomous, backend-driven flows (platform inbound replies, cron
 * tasks) can honor the same agent instructions, skills, and permissions
 * that the chat UI applies per message.
 *
 * Remote MCP selections are included as an authority boundary. The sidecar
 * can execute connected remote MCP tools headlessly, but only inside the
 * mounted server/tool scope captured here.
 */
export interface AgentRuntimeConfig {
  agentSystemPrompt?: string
  agentSkillsBlock?: string
  agentModel?: string
  permissionMode?: string
  permissionRules?: Record<string, unknown>
  workspaceRoots?: WorkspaceRoot[]
  agentMcpServers?: string[]
  agentMcpTools?: AgentMCPTool[]
}

/**
 * Keep the prompt lightweight: advertise enabled/agent-mounted skills by
 * metadata, then let the model read only the relevant SKILL.md file when a
 * task needs it. Embedding every skill body on every turn caused very large
 * prompts and unnecessary model prefill latency.
 */
export function formatAgentSkillsBlock(skills: SkillInfo[]): string | undefined {
  if (skills.length === 0) return undefined

  const entries = skills.map((skill) => {
    const name = skill.name.replace(/[\r\n]/g, ' ').trim()
    const description = (skill.description || 'No description provided.')
      .replace(/[\r\n]+/g, ' ')
      .trim()
      .slice(0, 180)
    const location = skill.location
      ? ` — file: ${skill.location.replace(/[\r\n]/g, '')}`
      : ''
    return `- ${name}: ${description}${location}`
  })

  return [
    '## Available Skills',
    'The following skills are available to this agent. Do not load or reproduce all skill instructions in advance.',
    'When a task clearly needs a listed skill, use the available filesystem/read tool to open only that skill\'s SKILL.md file, follow its instructions for that task, and then continue. If no listed skill is relevant, do not read any skill file.',
    ...entries,
  ].join('\n')
}

export function assembleAgentRuntimePrompt(
  agentSystemPrompt?: string,
  agentSkillsBlock?: string,
): string | undefined {
  const sections = [agentSystemPrompt, agentSkillsBlock]
    .map((section) => section?.trim())
    .filter((section): section is string => Boolean(section))
  return sections.length > 0 ? sections.join('\n\n') : undefined
}

export const DEFAULT_AGENT_ID = 'agent_default'

/**
 * Custom agents see only explicitly mounted skills. The default agent sees
 * every enabled skill, but only as a compact index; full skill bodies are
 * loaded on demand by the model when a task actually needs one.
 */
export function resolveAgentSkillNames(agent: Agent | null, availableSkills: SkillInfo[]): string[] {
  if (agent && agent.id !== DEFAULT_AGENT_ID && agent.skills.length > 0) {
    return [...agent.skills]
  }
  if (agent && agent.id !== DEFAULT_AGENT_ID) {
    return []
  }
  return availableSkills.filter((skill) => skill.enabled).map((skill) => skill.name)
}

export function buildAgentRuntimeSnapshot(
  agent: Agent | null,
  availableSkills: SkillInfo[],
  userProfile: string,
  selectedSkillNames?: string[],
  workspaceDir?: string,
): TaskAgentRuntime {
  const skillNames = selectedSkillNames ?? resolveAgentSkillNames(agent, availableSkills)
  const enabledSkills = skillNames
    .map((name) => availableSkills.find((skill) => skill.name === name))
    .filter((skill): skill is SkillInfo => Boolean(skill?.enabled))

  return {
    agentId: agent?.id,
    agentName: agent?.name || 'Default Assistant',
    agentSystemPrompt: agent
      ? assembleAgentSystemPrompt(agent, { userProfile, workspaceDir })
      : undefined,
    agentSkillsBlock: formatAgentSkillsBlock(enabledSkills),
    agentModel: agent?.model || undefined,
    permissionMode: agent?.permissionMode,
    permissionRules: agent?.permissionRules ? { ...agent.permissionRules } : undefined,
    workspaceRoots: agent?.workspaceRoots.map((root) => ({ ...root })) || [],
    agentMcpServers: agent ? [...agent.mcpServers] : [],
    agentMcpTools: agent ? agent.mcpTools.map((tool) => ({ ...tool })) : [],
    capturedAt: Date.now(),
  }
}

export function buildAgentRuntimeConfig(): AgentRuntimeConfig {
  const agentStore = useAgentStore.getState()
  const activeAgent = agentStore.activeAgentId
    ? agentStore.agents.find((a) => a.id === agentStore.activeAgentId)
    : null

  const skillStore = useSkillStore.getState()
  const snapshot = buildAgentRuntimeSnapshot(
    activeAgent || null,
    skillStore.skills,
    agentStore.userProfile,
    undefined,
    useAppStore.getState().workspaceDir || undefined,
  )

  return {
    agentSystemPrompt: snapshot.agentSystemPrompt,
    agentSkillsBlock: snapshot.agentSkillsBlock,
    agentModel: snapshot.agentModel,
    permissionMode: snapshot.permissionMode,
    permissionRules: snapshot.permissionRules,
    workspaceRoots: snapshot.workspaceRoots,
    agentMcpServers: activeAgent ? snapshot.agentMcpServers : undefined,
    agentMcpTools: activeAgent ? snapshot.agentMcpTools : undefined,
  }
}
