import type { Agent } from '../types/agent'
import { useWorkspaceStore } from '../stores/workspaceStore'
import { projectPathsEqual } from './projectPaths'

export interface WorkspacePromptContext {
  blocks: string[]
  mcpToolDefs: []
  sseMcpTools: []
  allowedSseMcpToolNames: []
}

/**
 * Build only Orbito-owned project context.
 *
 * MCP discovery, configuration, tool execution, and tool-result handling belong
 * to the JCode runtime. Do not enumerate Orbito's MCP store or inject duplicate
 * MCP tool listings into prompts; JCode reads its own MCP configuration.
 */
export function buildWorkspacePromptContext(
  workspaceMode: 'cowork' | 'code',
  workspaceDir: string | null | undefined,
  _activeAgent: Agent | null,
): WorkspacePromptContext {
  const blocks: string[] = []
  const workspace = useWorkspaceStore.getState()
  const projects = workspaceMode === 'code' ? workspace.codeProjects : workspace.projects
  const project = projects.find((item) =>
    item.path && workspaceDir && projectPathsEqual(item.path, workspaceDir),
  )

  if (project?.instructions?.trim()) {
    blocks.push('## Project Instructions\\n' + project.instructions.trim())
  }

  return {
    blocks,
    mcpToolDefs: [],
    sseMcpTools: [],
    allowedSseMcpToolNames: [],
  }
}
