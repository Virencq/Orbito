import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { useAppStore } from '../../stores'
import { X, Cpu, Server, Sparkles, CheckCircle, Sun, Moon, Globe, Upload, FileText } from 'lucide-react'
import { MCPSettings } from '../mcp'
import { SkillSettings } from '../skills'
import { WebSearchSettings } from '../websearch'
import { ScrollShadow } from "@heroui/react"
import i18n from '../../i18n'
import { COLOR_SCHEMES } from '../../themes'
import { ImportLibraryButton } from '../workspace/WorkspaceLibraryPage'
import { useMCPStore } from '../../stores/mcpStore'
import { JCodeModelControls } from './JCodeModelControls'
import { GlobalInstructionsSettings } from './GlobalInstructionsSettings'
import { useSkillStore } from '../../stores/skillStore'
import { probeJCode, runDoctor, inspectJCodeConfig, updateRuntimeSettings, type JCodeConfigInspection, type JCodeDoctorResult, type JCodeRuntimeInfo, type JCodeRuntimeSettings } from '../../utils/jcodeClient'

type JCodeStatus = { installed: boolean; path?: string; error?: string }

interface SettingsModalProps {
  onClose: () => void
  initialTab?: string
  open?: boolean
}

function JCodeRuntimeSettings() {
  const [status, setStatus] = useState<JCodeStatus | null>(null)
  const [checking, setChecking] = useState(false)
  const [runtime, setRuntime] = useState<JCodeRuntimeInfo | null>(null)
  const [settings, setSettings] = useState<JCodeRuntimeSettings>({ defaultMode: 'approval', defaultContextLimit: 200000, compactionEnabled: false, compactionThreshold: 0.8 })
  const [savingSettings, setSavingSettings] = useState(false)
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null)
  const [doctor, setDoctor] = useState<JCodeDoctorResult | null>(null)
  const [diagnosing, setDiagnosing] = useState(false)
  const [doctorError, setDoctorError] = useState<string | null>(null)
  const [configInspection, setConfigInspection] = useState<JCodeConfigInspection | null>(null)
  const [inspectingConfig, setInspectingConfig] = useState(false)
  const [inspectionError, setInspectionError] = useState<string | null>(null)

  const inspectConfig = async () => {
    setInspectingConfig(true)
    setInspectionError(null)
    try {
      setConfigInspection(await inspectJCodeConfig())
    } catch (error) {
      setInspectionError(error instanceof Error ? error.message : String(error))
      setConfigInspection(null)
    } finally {
      setInspectingConfig(false)
    }
  }

  const diagnose = async () => {
    setDiagnosing(true)
    setDoctorError(null)
    try {
      setDoctor(await runDoctor())
    } catch (error) {
      setDoctorError(error instanceof Error ? error.message : String(error))
      setDoctor(null)
    } finally {
      setDiagnosing(false)
    }
  }

  const saveSettings = async () => {
    setSavingSettings(true)
    setSettingsMessage(null)
    try {
      const next = await updateRuntimeSettings(settings)
      setRuntime(next)
      setSettingsMessage('JCode runtime preferences saved to its config.json.')
    } catch (error) {
      setSettingsMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setSavingSettings(false)
    }
  }

  const check = async (force = false) => {
    setChecking(true)
    try {
      const result = await probeJCode(force)
      setStatus(result.status)
      setRuntime(result.runtime)
      if (result.runtime) {
        setSettings({
          defaultMode: result.runtime.defaultMode === 'plan' || result.runtime.defaultMode === 'full_access' ? result.runtime.defaultMode : 'approval',
          defaultContextLimit: result.runtime.defaultContextLimit ?? 200000,
          compactionEnabled: result.runtime.compactionEnabled ?? false,
          compactionThreshold: result.runtime.compactionThreshold ?? 0.8,
        })
      }
    } catch (error) {
      setStatus({
        installed: false,
        error: error instanceof Error ? error.message : String(error),
      })
      setRuntime(null)
    } finally {
      setChecking(false)
    }
  }

  useEffect(() => {
    // Read the shared startup promise/cache; only the explicit button forces a probe.
    void check()
  }, [])

  return (
    <ScrollShadow className="h-full px-8 py-7">
      <div className="max-w-3xl mx-auto space-y-5">
        <div className="rounded-xl border border-border bg-surface p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[15px] font-semibold text-text">JCode CLI</div>
              <p className="mt-1 text-[12px] leading-5 text-text-tertiary">Cowork uses the JCode CLI installed on this computer through the ACP protocol.</p>
            </div>
            <span className={`rounded-full px-3 py-1.5 text-[11px] font-semibold ${status?.installed ? 'bg-green-500/10 text-green-600' : 'bg-amber-500/10 text-amber-600'}`}>
              {status?.installed ? 'Installed' : 'Not detected'}
            </span>
          </div>
          {status?.path && (
            <div className="mt-5 rounded-lg border border-border bg-surface-secondary px-3 py-2.5">
              <div className="text-[10px] uppercase tracking-widest text-text-quaternary">Executable</div>
              <div className="mt-1 text-[12px] font-mono text-text-secondary break-all">{status.path}</div>
            </div>
          )}
          {status?.error && <div className="mt-4 text-[12px] text-red-600">{status.error}</div>}
          <button onClick={() => void check(true)} disabled={checking} className="mt-4 rounded-lg border border-border px-4 py-2 text-[12px] font-semibold text-text-secondary hover:bg-surface-secondary">
            {checking ? 'Checking…' : 'Check JCode'}
          </button>
        </div>

        <JCodeModelControls />

        <div className="rounded-xl border border-border bg-surface p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[15px] font-semibold text-text">Runtime diagnostics</div>
              <p className="mt-1 text-[12px] leading-5 text-text-tertiary">Run JCode's official doctor command to check model and MCP connectivity. This uses the installed CLI and does not change its configuration.</p>
            </div>
            <button onClick={() => void diagnose()} disabled={diagnosing || !status?.installed} className="shrink-0 rounded-lg border border-border px-3 py-2 text-[12px] font-semibold text-text-secondary hover:bg-surface-secondary disabled:opacity-50">
              {diagnosing ? 'Running…' : 'Run jcode doctor'}
            </button>
          </div>
          {doctorError && <div className="mt-3 rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-[12px] text-red-600">{doctorError}</div>}
          {doctor && (
            <div className="mt-3 space-y-2">
              <div className={`text-[12px] font-semibold ${doctor.success ? 'text-green-600' : 'text-amber-600'}`}>
                {doctor.success ? 'Doctor completed successfully' : `Doctor reported issues${doctor.code == null ? '' : ` (exit code ${doctor.code})`}`}
              </div>
              {doctor.stdout && <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-surface-secondary p-3 text-[11px] leading-5 text-text-secondary">{doctor.stdout}</pre>}
              {doctor.stderr && <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-surface-secondary p-3 text-[11px] leading-5 text-red-600">{doctor.stderr}</pre>}
            </div>
          )}

          <div className="mt-4 border-t border-border pt-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[13px] font-semibold text-text">JCode configuration inspector</div>
                <p className="mt-1 text-[12px] leading-5 text-text-tertiary">Read-only inspection starts in .jcode. Reports file metadata and selected settings only; it does not display credentials or modify files.</p>
              </div>
              <button onClick={() => void inspectConfig()} disabled={inspectingConfig} className="shrink-0 rounded-lg border border-border px-3 py-2 text-[12px] font-semibold text-text-secondary hover:bg-surface-secondary disabled:opacity-50">
                {inspectingConfig ? 'Inspecting…' : 'Inspect .jcode'}
              </button>
            </div>
            {inspectionError && <div className="mt-3 rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-[12px] text-red-600">{inspectionError}</div>}
            {configInspection && (
              <div className="mt-3 space-y-3">
                <div className="rounded-lg border border-border bg-surface-secondary p-3">
                  <div className="text-[10px] uppercase tracking-widest text-text-tertiary">Configuration home</div>
                  <div className="mt-1 break-all font-mono text-[12px] text-text-secondary">{configInspection.home}</div>
                  <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 text-[12px] text-text-secondary">
                    <div>mcp_tools: <span className="font-mono">{configInspection.settings.mcpTools ?? 'not found'}</span></div>
                    <div>Schema threshold: <span className="font-mono">{configInspection.settings.mcpToolsTokenThreshold ?? 'not found'}</span></div>
                    <div>MCP servers in mcp.json: <span className="font-mono">{configInspection.settings.configuredMcpServers ?? 'unknown'}</span></div>
                    <div>Managed entries: <span className="font-mono">{configInspection.settings.managedMcpServers ?? 'unknown'}</span></div>
                    <div>Cached tool entries: <span className="font-mono">{configInspection.settings.cachedToolArrayEntries ?? 'unknown'}</span></div>
                    <div>Context limit: <span className="font-mono">{configInspection.settings.contextLimit ?? 'unknown'}</span></div>
                  </div>
                </div>
                <div className="overflow-auto rounded-lg border border-border">
                  <div className="grid grid-cols-[minmax(120px,1fr)_72px_76px] gap-2 border-b border-border bg-surface-secondary px-3 py-2 text-[10px] uppercase tracking-wider text-text-tertiary">
                    <span>File</span><span>Status</span><span>Size</span>
                  </div>
                  {configInspection.files.map((file) => (
                    <div key={file.name} className="grid grid-cols-[minmax(120px,1fr)_72px_76px] gap-2 border-b border-border last:border-0 px-3 py-2 text-[11px]">
                      <div className="min-w-0">
                        <div className="break-all font-mono text-text-secondary">{file.name}</div>
                        <div className="text-text-tertiary">{file.note}</div>
                      </div>
                      <span className={file.exists ? 'text-green-600' : 'text-text-tertiary'}>{file.exists ? 'Found' : 'Missing'}</span>
                      <span className="text-text-tertiary">{file.bytes == null ? '—' : file.bytes.toLocaleString() + ' B'}</span>
                    </div>
                  ))}
                </div>
                <ul className="list-disc space-y-1 pl-5 text-[11px] leading-5 text-text-tertiary">
                  {configInspection.interpretation.map((item, index) => <li key={index}>{item}</li>)}
                </ul>
              </div>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-surface p-5">
          <div className="text-[15px] font-semibold text-text">JCode runtime preferences</div>
          <p className="mt-1 text-[12px] leading-5 text-text-tertiary">These controls update supported fields in <span className="font-mono">~/.jcode/config.json</span>. Provider credentials and model definitions are left untouched.</p>
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block text-[12px] font-medium text-text-secondary">
              Default execution mode
              <select value={settings.defaultMode} onChange={(event) => setSettings(current => ({ ...current, defaultMode: event.target.value as JCodeRuntimeSettings['defaultMode'] }))} className="mt-1.5 w-full rounded-lg border border-border bg-surface-secondary px-3 py-2.5 text-[13px] text-text">
                <option value="approval">Ask for approval (recommended)</option>
                <option value="plan">Plan mode</option>
                <option value="full_access">Full access</option>
              </select>
            </label>
            <label className="block text-[12px] font-medium text-text-secondary">
              Default context limit (tokens)
              <input type="number" min={1024} max={2000000} step={1024} value={settings.defaultContextLimit} onChange={(event) => setSettings(current => ({ ...current, defaultContextLimit: Number(event.target.value) }))} className="mt-1.5 w-full rounded-lg border border-border bg-surface-secondary px-3 py-2.5 text-[13px] text-text" />
            </label>
            <label className="flex items-center gap-3 rounded-lg border border-border bg-surface-secondary p-3 text-[12px] text-text-secondary">
              <input type="checkbox" checked={settings.compactionEnabled} onChange={(event) => setSettings(current => ({ ...current, compactionEnabled: event.target.checked }))} className="accent-[var(--color-accent)]" />
              Enable automatic context compaction
            </label>
            <label className="block text-[12px] font-medium text-text-secondary">
              Compaction threshold ({Math.round(settings.compactionThreshold * 100)}%)
              <input type="range" min={0.5} max={0.99} step={0.01} value={settings.compactionThreshold} onChange={(event) => setSettings(current => ({ ...current, compactionThreshold: Number(event.target.value) }))} className="mt-3 w-full accent-[var(--color-accent)]" />
            </label>
          </div>
          {settingsMessage && <p className={`mt-3 text-[12px] ${settingsMessage.includes('saved') ? 'text-green-600' : 'text-red-600'}`}>{settingsMessage}</p>}
          <div className="mt-4 flex justify-end">
            <button onClick={() => void saveSettings()} disabled={savingSettings || !status?.installed || !Number.isFinite(settings.defaultContextLimit) || settings.defaultContextLimit < 1024 || settings.defaultContextLimit > 2000000} className="rounded-lg bg-accent px-4 py-2.5 text-[12px] font-semibold text-accent-foreground hover:bg-accent-light disabled:opacity-50">
              {savingSettings ? 'Saving…' : 'Save JCode preferences'}
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-surface p-5">
          <div className="text-[15px] font-semibold text-text">MCP configuration</div>
          <p className="mt-1 text-[12px] leading-5 text-text-tertiary">
            Enabled stdio connectors are synchronized to JCode's user MCP configuration before a task starts.
          </p>
          <div className="mt-4 rounded-lg border border-border bg-surface-secondary px-3 py-2.5 text-[12px] font-mono text-text-secondary">
            %USERPROFILE%\\.jcode\\mcp.json
          </div>
        </div>
      </div>
    </ScrollShadow>
  )
}

export function SettingsModal({ onClose, initialTab = 'provider', open = true }: SettingsModalProps) {
  const { theme, setTheme, colorScheme, setColorScheme, locale, setLocale } = useAppStore()
  const [activeTab, setActiveTab] = useState(initialTab)

  // The modal is rendered through a portal, so hiding its parent in App.tsx
  // does not hide this overlay. Keep hooks warm but remove the portal when closed.
  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-100 flex items-center justify-center p-4 sm:p-8 bg-black/45 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-[1120px] h-[min(820px,90vh)] flex flex-row bg-bg shadow-(--shadow-dialog) rounded-xl border border-border animate-scale-in relative overflow-hidden">
        
        {/* Settings Sidebar */}
        <aside className="w-[232px] bg-surface-secondary border-r border-border flex flex-col shrink-0 relative">
          <div className="px-6 pt-7 pb-6 relative z-10">
            <p className="section-eyebrow mb-2">Settings</p>
            <h2 className="text-[24px] font-semibold text-text tracking-[-0.03em] leading-tight">Settings</h2>
          </div>

          <nav className="flex-1 px-3 space-y-1 overflow-y-auto scrollbar-subtle">
            {[
              { id: 'provider', icon: Cpu, label: 'JCode Runtime' },
              { id: 'instructions', icon: FileText, label: 'Global Instructions' },
              { id: 'mcp', icon: Server, label: 'MCP Servers' },
              { id: 'skills', icon: Sparkles, label: 'Skills' },
              { id: 'websearch', icon: Globe, label: 'Web Search' },
              { id: 'appearance', icon: theme === 'light' ? Sun : Moon, label: 'Appearance' },
              { id: 'library', icon: Upload, label: 'Import Claude Cowork' },
            ].map((item) => (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-semibold transition-colors duration-150 group relative ${
                  activeTab === item.id
                    ? 'text-accent'
                    : 'text-text-secondary hover:bg-surface-tertiary/70 hover:text-text'
                }`}
              >
                {activeTab === item.id && (
                  <motion.div 
                    layoutId="activeTab"
                    className="absolute inset-0 bg-accent-subtle rounded-lg border border-accent/20"
                  />
                )}
                <item.icon size={17} className={`relative z-10 transition-colors duration-150 ${activeTab === item.id ? 'text-accent' : 'text-text-tertiary group-hover:text-text-secondary'}`} />
                <span className="relative z-10">{item.label}</span>
              </button>
            ))}
          </nav>

          <div className="px-4 pb-4 pt-3">
            <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-surface border border-border">
              <div className="relative">
                <div className="w-2 h-2 rounded-full bg-green-500" />
              </div>
              <span className="text-[11px] font-semibold text-text-secondary">
                JCode-managed
              </span>
            </div>
          </div>
        </aside>

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col min-w-0 bg-bg">
          {/* Header */}
          <header className="shrink-0 flex items-center justify-between px-8 h-[76px] border-b border-border">
            <div className="flex flex-col">
              <h3 className="text-xl font-semibold text-text tracking-[-0.02em]">
                {activeTab === 'provider' && 'JCode Runtime'}
              {activeTab === 'instructions' && 'Global Instructions'}
              {activeTab === 'mcp' && 'MCP Servers'}
              {activeTab === 'skills' && 'Skills'}
              {activeTab === 'websearch' && 'Web Search'}
              {activeTab === 'appearance' && 'Appearance'}
              {activeTab === 'library' && 'Import Claude Cowork'}
              </h3>
              <p className="text-[12px] text-text-tertiary mt-1">Runtime and workspace configuration for the installed JCode CLI.</p>
            </div>
            <button
              onClick={onClose}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-surface-secondary text-text-tertiary hover:text-text hover:bg-surface-tertiary transition-colors duration-150 border border-border"
            >
              <X size={18} />
            </button>
          </header>

          {/* Content Area */}
          <div className="flex-1 overflow-hidden">
            {activeTab === 'provider' && <JCodeRuntimeSettings />}
            {activeTab === 'instructions' && <GlobalInstructionsSettings />}

            {activeTab === 'library' && (
              <ScrollShadow className="h-full px-8 py-7 animate-fade-in">
                <div className="max-w-3xl mx-auto space-y-5">
                  <div>
                    <div className="section-eyebrow mb-2">Migration</div>
                    <h4 className="text-xl font-semibold text-text">Bring your Claude work into Cowork</h4>
                    <p className="mt-1 text-[13px] leading-6 text-text-tertiary">
                      Import a Claude data-export ZIP, conversations.json file, or Cowork backup bundle. Supported chats, projects, artifacts, skills, and connector definitions are merged into Cowork without replacing existing data.
                    </p>
                  </div>
                  <div className="rounded-xl border border-border bg-surface p-5">
                    <div className="flex items-center justify-between gap-5">
                      <div>
                        <div className="text-[14px] font-semibold text-text">Import Claude Cowork data</div>
                        <p className="mt-1 text-[12px] leading-5 text-text-tertiary">Choose the export or backup file. Chat history is added to your conversation list; duplicate chat IDs and connector names are skipped.</p>
                      </div>
                      <ImportLibraryButton />
                    </div>
                  </div>
                  <div className="rounded-xl border border-border bg-surface p-5">
                    <div className="text-[14px] font-semibold text-text">Refresh local integrations</div>
                    <p className="mt-1 text-[12px] leading-5 text-text-tertiary">
                      Re-scan skills on disk and refresh configured MCP connectors.
                    </p>
                    <button
                      onClick={() => {
                        void useSkillStore.getState().refreshSkills()
                        void useMCPStore.getState().refreshAllServers(true)
                      }}
                      className="mt-4 rounded-lg border border-border bg-surface-secondary px-4 py-2.5 text-[12px] font-semibold text-text-secondary hover:text-text"
                    >
                      Refresh skills & connectors
                    </button>
                  </div>
                  <div className="rounded-xl border border-[#d97745]/20 bg-[#fff8f3] p-5">
                    <div className="text-[13px] font-semibold text-[#684f42]">About Claude imports</div>
                    <p className="mt-1 text-[12px] leading-5 text-[#8b6d5b]">
                      Claude provides a personal data export, but it does not provide a general API that lets this app pull private projects, connectors, or artifacts directly.
                      This workflow imports data present in the selected file. Local project folders, plugin packages, and credentials that are not included in the export must be added or reconnected separately. Imported plugin/configuration files are not executed automatically.
                    </p>
                  </div>
                </div>
              </ScrollShadow>
            )}

            {activeTab === 'appearance' && (
              <ScrollShadow className="h-full px-8 py-7 animate-fade-in">
                <div className="max-w-3xl mx-auto">
                  <div className="mb-8">
                    <div className="flex flex-col mb-6">
                      <h4 className="section-eyebrow mb-2">Visual style</h4>
                      <h2 className="text-xl font-semibold text-text tracking-[-0.02em]">Interface theme</h2>
                      <p className="text-[13px] text-text-tertiary mt-1">Choose the appearance of Cowork.</p>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      {(['light', 'dark'] as const).map((th) => (
                        <button
                          key={th}
                          onClick={() => setTheme(th)}
                          className={`group relative flex items-center gap-4 p-4 rounded-lg border transition-colors duration-150 ${
                            theme === th 
                              ? 'border-accent bg-accent-subtle'
                              : 'border-border hover:border-border-hover bg-surface'
                          }`}
                        >
                          <div className={`p-2.5 rounded-lg transition-colors duration-150 ${
                            theme === th 
                              ? 'bg-accent text-accent-foreground'
                              : 'bg-surface-secondary text-text-tertiary group-hover:text-text group-hover:bg-surface-tertiary'
                          }`}>
                            {th === 'light' ? <Sun size={21} /> : <Moon size={21} />}
                          </div>
                          <div className="text-left">
                            <span className={`text-[14px] font-semibold block ${
                              theme === th ? 'text-accent' : 'text-text'
                            }`}>
                              {th === 'light' ? 'Light' : 'Dark'}
                            </span>
                            <span className="text-[11px] text-text-tertiary mt-0.5 block">
                              {th === 'light' ? 'Clean and bright' : 'Dark and focused'}
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>

                    {/* Color Scheme Picker */}
                    <div className="mt-8 pt-7 border-t border-border">
                      <div className="flex flex-col mb-5">
                        <span className="section-eyebrow mb-2">Color Palette</span>
                        <h4 className="text-lg font-semibold text-text tracking-tight">Color palette</h4>
                        <p className="text-[13px] text-text-tertiary mt-1 font-medium opacity-70">Choose the accent color used across the interface.</p>
                      </div>
                      <div className="grid grid-cols-3 gap-3">
                        {COLOR_SCHEMES.map((scheme) => (
                          <button
                            key={scheme.id}
                            onClick={() => setColorScheme(scheme.id)}
                            className={`group relative flex items-center gap-3 p-3 rounded-lg border transition-colors duration-150 ${
                              colorScheme === scheme.id
                                ? 'border-accent bg-accent-subtle'
                                : 'border-border hover:border-border-hover bg-surface'
                            }`}
                          >
                            {/* Color swatch preview */}
                            <div className={`shrink-0 p-1.5 rounded-md transition-colors duration-150 border ${
                              colorScheme === scheme.id
                                ? 'border-accent/30'
                                : 'border-border'
                            }`}
                              style={{ backgroundColor: scheme.previewColor + '15' }}
                            >
                              <div className="flex">
                                <div
                                  className="w-5 h-5 rounded-full ring-1 ring-white/30"
                                  style={{ backgroundColor: scheme.previewColor }}
                                />
                                <div
                                  className="-ml-1.5 w-5 h-5 rounded-full opacity-50"
                                  style={{ backgroundColor: scheme.previewColor }}
                                />
                                <div
                                  className="-ml-1.5 w-5 h-5 rounded-full opacity-25"
                                  style={{ backgroundColor: scheme.previewColor }}
                                />
                              </div>
                            </div>
                            <div className="min-w-0 text-left">
                              <span className={`text-[13px] font-semibold truncate block ${
                                colorScheme === scheme.id ? 'text-accent' : 'text-text'
                              }`}>
                                {locale.startsWith('zh') ? scheme.nameZh : scheme.name}
                              </span>
                              <span className="text-[10px] text-text-tertiary truncate mt-0.5 block">
                                {scheme.name}
                              </span>
                            </div>
                            {colorScheme === scheme.id && (
                              <CheckCircle size={14} className="absolute top-2 right-2 text-accent animate-fade-in" />
                            )}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="mt-8 pt-7 border-t border-border">
                      <div className="flex flex-col mb-4">
                        <span className="section-eyebrow">Language</span>
                      </div>
                      <div className="flex gap-3">
                        {['en', 'zh'].map((l) => (
                          <button
                            key={l}
                            onClick={() => {
                              setLocale('en')
                              i18n.changeLanguage('en')
                            }}
                            className={`flex-1 py-3 px-4 rounded-lg border text-center transition-colors duration-150 ${
                              locale === l
                                ? 'border-accent bg-accent-subtle'
                                : 'border-border hover:border-accent/30 bg-surface'
                            }`}
                          >
                            <span className={`text-[13px] font-semibold block ${locale === l ? 'text-accent' : 'text-text'}`}>
                              English
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </ScrollShadow>
            )}

            {activeTab === 'mcp' && (
              <ScrollShadow className="h-full px-8 py-7">
                <MCPSettings />
              </ScrollShadow>
            )}
            {activeTab === 'skills' && (
              <ScrollShadow className="h-full px-8 py-7">
                <SkillSettings />
              </ScrollShadow>
            )}
            {activeTab === 'websearch' && (
              <ScrollShadow className="h-full px-8 py-7">
                <WebSearchSettings />
              </ScrollShadow>
            )}
          </div>

          <footer className="shrink-0 flex items-center justify-end px-8 h-[68px] border-t border-border bg-surface-secondary/55">
            <button onClick={onClose} className="px-5 py-2.5 rounded-lg bg-accent text-accent-foreground text-[13px] font-semibold hover:bg-accent-light">Close</button>
          </footer>
        </div>

      </div>
    </div>,
    document.body
  )
}
