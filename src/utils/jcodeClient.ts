import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export interface McpToolDef { serverName: string; name: string; description?: string; inputSchema?: unknown; }
export interface ContextStatus { type: string; [key: string]: unknown; }

export interface JCodePromptOptions {
  systemPrompt?: string;
  providerID?: string;
  providerAPI?: string;
  providerConfig?: unknown;
  modelID?: string;
  thinkingLevel?: string;
  apiKey?: string;
  workspaceDir?: string;
  workspaceRoots?: unknown[];
  tools?: McpToolDef[];
  permissionMode?: string;
  permissionRules?: unknown;
  images?: Array<{ data: string; mimeType: string }>;
  webSearchConfig?: unknown;
  allowedSseMcpToolNames?: string[];
}

export interface StreamHandlers {
  onText?: (partId: string, delta: string) => void;
  onThinking?: (delta: string) => void;
  onToolCall?: (id: string, name: string, args: unknown) => void;
  onToolResult?: (id: string, name: string, result: unknown) => void;
  onToolApproval?: (request: any) => void;
  onMcpToolRequest?: (request: any) => void;
  onStatus?: (status: ContextStatus) => void;
  onDone?: () => void;
}

function extractText(value: any): string {
  if (value == null) return ''

  if (typeof value === 'string') return value

  // ACP agent_message_chunk uses:
  // { sessionUpdate: 'agent_message_chunk',
  //   content: { type: 'text', text: '...' } }
  const direct = [
    value?.text,
    value?.delta?.text,
    value?.delta?.content,
    value?.content?.text,
    value?.content?.delta?.text,
    value?.content?.delta?.content,
    value?.textDelta,
  ].find((v) => typeof v === 'string' && v.length > 0)
  if (direct) return direct

  if (Array.isArray(value?.content)) {
    return value.content.map((item: any) => extractText(item)).filter(Boolean).join('')
  }

  if (Array.isArray(value?.delta)) {
    return value.delta.map((item: any) => extractText(item)).filter(Boolean).join('')
  }

  return ''
}

function extractUpdate(event: any, handlers: StreamHandlers) {
  const method = event?.method || '';
  const p = event?.params ?? {};

  if (event?.result?.stopReason) {
    handlers.onDone?.();
    return;
  }

  if (method === 'session/update') {
    const update = p.update ?? p;
    const kind = update?.sessionUpdate || update?.type || '';

    if (kind === 'agent_message_chunk' || kind.includes('text')) {
      const text = extractText(update);
      if (text) handlers.onText?.('jcode-text', text);
    } else if (kind === 'agent_thought_chunk' || kind.includes('thought') || kind.includes('reason')) {
      const text = extractText(update);
      if (text) handlers.onThinking?.(text);
    } else if (kind === 'tool_call') {
      const id = update.toolCallId || update.id || 'tool-' + Date.now();
      const name = update.title || update.name || update.toolName || 'tool';
      handlers.onToolCall?.(id, name, update.rawInput || update.arguments || update.args || {});
    } else if (kind === 'tool_call_update') {
      const id = update.toolCallId || update.id || 'tool';
      const name = update.title || update.name || update.toolName || 'tool';
      handlers.onToolResult?.(id, name, update);
    }
  } else if (method === 'session/request_permission' || method === 'session/permission_request') {
    handlers.onToolApproval?.({
      ...p,
      requestId: String(event?.id ?? p?.requestId ?? ''),
      toolName: p?.toolName || p?.toolCall?.title || p?.toolCall?.kind || 'tool',
      args: p?.arguments || p?.toolCall?.rawInput || p?.toolCall?.content || {},
      reason: p?.reason || p?.description || p?.title,
    });
  } else if (method === 'session/closed') {
    handlers.onDone?.();
  }
}

export interface JCodeProbe {
  status: { installed: boolean; path?: string; error?: string };
  runtime: JCodeRuntimeInfo | null;
}

// One shared probe per app session. Startup and Settings consume the same
// promise/result; opening or closing Settings never launches another CLI probe.
let jcodeProbeCache: JCodeProbe | null = null;
let jcodeProbeInFlight: Promise<JCodeProbe> | null = null;

export async function probeJCode(force = false): Promise<JCodeProbe> {
  if (!force && jcodeProbeCache) return jcodeProbeCache;
  if (!force && jcodeProbeInFlight) return jcodeProbeInFlight;

  const probe = (async (): Promise<JCodeProbe> => {
    let nextStatus: { installed: boolean; path?: string; error?: string };
    let runtime: JCodeRuntimeInfo | null = null;
    try {
      nextStatus = await invoke<{ installed: boolean; path?: string; error?: string }>('jcode_status');
      if (nextStatus.installed) {
        try {
          runtime = await invoke<JCodeRuntimeInfo>('jcode_runtime_info');
        } catch {
          // Runtime metadata is optional; installed status remains authoritative.
        }
      }
    } catch (error) {
      // Cache failures too, so Settings does not retry a broken probe on every open.
      nextStatus = {
        installed: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    const result = { status: nextStatus, runtime };
    jcodeProbeCache = result;
    return result;
  })();

  jcodeProbeInFlight = probe;
  try {
    return await probe;
  } finally {
    if (jcodeProbeInFlight === probe) jcodeProbeInFlight = null;
  }
}

export async function status() {
  return (await probeJCode()).status;
}

export async function createSession(workspaceDir?: string): Promise<{ id: string }> {
  const id = await invoke<string>('jcode_start_session', { workspaceDir });
  return { id };
}

export async function syncMcpConfig(servers: unknown[]) {
  return invoke<{ path: string; servers: number }>('jcode_sync_mcp_config', { servers })
}

export interface JCodeRuntimeInfo {
  installed: boolean
  path?: string
  configPath?: string
  configExists?: boolean
  provider?: string | null
  model?: string | null
  smallModel?: string | null
  effort?: string | null
  defaultMode?: 'approval' | 'plan' | 'full_access' | string
  defaultContextLimit?: number | null
  contextLimitOverrides?: number
  compactionEnabled?: boolean
  compactionThreshold?: number | null
  configuredMcpServers?: number
  disabledSkills?: number
  skillsPath?: string
  skillsExists?: boolean
  mcpPath?: string
  mcpConfigExists?: boolean
}

export interface JCodeRuntimeSettings {
  defaultMode: 'approval' | 'plan' | 'full_access'
  defaultContextLimit: number
  compactionEnabled: boolean
  compactionThreshold: number
}

export async function runtimeInfo(): Promise<JCodeRuntimeInfo> {
  return invoke<JCodeRuntimeInfo>('jcode_runtime_info')
}

export async function updateRuntimeSettings(settings: JCodeRuntimeSettings): Promise<JCodeRuntimeInfo> {
  return invoke<JCodeRuntimeInfo>('jcode_update_runtime_settings', {
    defaultMode: settings.defaultMode,
    defaultContextLimit: settings.defaultContextLimit,
    compactionEnabled: settings.compactionEnabled,
    compactionThreshold: settings.compactionThreshold,
  })
}

export interface JCodeDoctorResult {
  success: boolean
  code?: number | null
  stdout: string
  stderr: string
  command: string
}

export async function runDoctor(): Promise<JCodeDoctorResult> {
  return invoke<JCodeDoctorResult>('jcode_doctor')
}

export interface JCodeConfigInspection {
  home: string
  files: Array<{ name: string; path: string; exists: boolean; bytes?: number | null; validJson?: boolean | null; note: string }>
  settings: {
    mcpTools?: string | null
    mcpToolsTokenThreshold?: number | null
    mcpProfile?: string | null
    toolProfile?: string | null
    configuredMcpServers?: number | null
    managedMcpServers?: number | null
    cachedToolArrayEntries?: number | null
    schemaCacheTopLevelKeys?: number | null
    provider?: string | null
    model?: string | null
    contextLimit?: number | null
  }
  interpretation: string[]
  secretsExposed: boolean
}

export async function inspectJCodeConfig(): Promise<JCodeConfigInspection> {
  return invoke<JCodeConfigInspection>('jcode_inspect_config')
}

export interface JCodeModelOption { id: string; name: string }
export interface JCodeProviderOption { id: string; name: string; models: JCodeModelOption[] }
export interface JCodeModelCatalog {
  activeModel: string
  providers: JCodeProviderOption[]
  effortOverrides: Record<string, string>
  configPath: string
  modelStatePath: string
}

export async function getModelCatalog(): Promise<JCodeModelCatalog> {
  return invoke<JCodeModelCatalog>('jcode_model_catalog')
}

export async function setActiveModel(provider: string, model: string): Promise<JCodeModelCatalog> {
  return invoke<JCodeModelCatalog>('jcode_set_active_model', { provider, model })
}

export async function setModelEffort(provider: string, model: string, effort: '' | 'low' | 'medium' | 'high'): Promise<JCodeModelCatalog> {
  return invoke<JCodeModelCatalog>('jcode_set_model_effort', { provider, model, effort })
}

export function getBaseUrl() { return ''; }
export async function waitForServer(..._args: any[]) { return true; }

export async function fetchModels(..._args: any[]) {
  return [] as Array<{ id: string; name: string }>;
}

export async function fetchProviders(): Promise<any[]> {
  return [];
}

export async function fetchModelCapabilities(..._args: any[]): Promise<any> {
  return {
    reasoning: true,
    supportedThinkingLevels: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
    recommendedThinkingLevel: 'medium',
  };
}

export async function prompt(sessionId: string, text: string, options: JCodePromptOptions = {}) {
  // Centralize global instruction injection so every JCode prompt path uses the
  // same saved file (chat, Code, and scheduled/background prompts).
  let globalInstructions = ''
  try {
    const document = await invoke<{ path: string; content: string }>('jcode_read_global_instructions')
    globalInstructions = document.content.trim()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[Orbito] Global instructions could not be loaded; prompt was not sent:', message)
    return { text: '', error: `Global instructions could not be loaded: ${message}. Check your .jcode/AGENTS.md file and retry.` }
  }

  const promptSections = [
    globalInstructions
      ? 'GLOBAL USER INSTRUCTIONS — follow these across all projects and sessions. Treat them as persistent operating requirements unless they conflict with safety or the user’s current explicit request.\n\n' + globalInstructions
      : '',
    options.systemPrompt?.trim() || '',
    text,
  ].filter(Boolean)
  const finalPrompt = promptSections.join('\n\n')

  let unlisten: (() => void) | undefined
  let settled = false
  let resolveCompletion!: (result: { text: string; error?: string }) => void
  const completion = new Promise<{ text: string; error?: string }>((resolve) => {
    resolveCompletion = resolve
  })

  const finish = (result: { text: string; error?: string }) => {
    if (settled) return
    settled = true
    unlisten?.()
    resolveCompletion(result)
  }

  try {
    unlisten = await listen<any>('jcode://event', (event) => {
      const payload = event.payload
      if (payload?.sessionId !== sessionId) return
      const rpc = payload?.event

      if (rpc?.error) {
        finish({ text: '', error: String(rpc.error?.message || rpc.error) })
      } else if (rpc?.result?.stopReason) {
        finish({ text: '' })
      } else if (rpc?.method === 'session/closed') {
        finish({ text: '', error: 'JCode ACP session closed before the prompt completed.' })
      }
    })

    // A completion event can arrive immediately after listener registration.
    if (settled) unlisten()

    // The completion listener must be installed before sending the ACP request.
    await invoke('jcode_prompt', {
      sessionId,
      prompt: finalPrompt,
      ...(options.images?.length ? { images: options.images } : {}),
    })
  } catch (error) {
    unlisten?.()
    return { text: '', error: error instanceof Error ? error.message : String(error) }
  }

  return completion
}

export async function abortSession(sessionId: string) {
  await invoke('jcode_cancel', { sessionId });
}

export async function deleteSession(sessionId: string) {
  await invoke('jcode_close_session', { sessionId });
}

export async function subscribeStream(sessionId: string, handlers: StreamHandlers) {
  const unlisten = await listen<any>('jcode://event', (event) => {
    const payload = event.payload;
    if (payload?.sessionId === sessionId) extractUpdate(payload.event, handlers);
  });
  return () => { unlisten(); };
}

export async function sendMcpToolResponse(_sessionId: string, _requestId: string, _result: unknown, _error?: string) {}
export async function sendToolApproval(sessionId: string, requestId: string, decision: boolean) {
  await invoke('jcode_permission_response', {
    sessionId,
    requestId,
    approve: decision,
  })
}
export function installJCodeFetchInterceptor() {}
export function setServerConnection(_url: string, _token: string) {}
export async function syncRuntimeConfig(_config: unknown) {}

export interface SubagentInfo {
  name: string;
  description: string;
  model?: string;
  tools: string[];
  source: 'builtin' | 'user';
}

export interface SubagentRunInfo {
  runId: string;
  agent: string;
  task: string;
  status: string;
  usage: { input: number; output: number; turns: number };
  budget: { maxTurns: number; maxTokens: number };
  durationMs?: number;
  errorMessage?: string;
  stopReason?: string;
}

export async function fetchSubagents(_projectDir?: string): Promise<SubagentInfo[]> { return []; }
export async function fetchSubagentRuns(_limit = 12): Promise<SubagentRunInfo[]> { return []; }
export async function saveSubagent(_name: string, _config: unknown) { return { ok: true }; }
export async function deleteSubagent(_name: string, _projectDir?: string) {}
export async function cancelSubagentRun(_runId: string) {}
