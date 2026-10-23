import { useEffect, useState } from 'react'
import { FolderOpen, FileCode2, X, Files, GitBranch, ArrowUpRight } from 'lucide-react'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { FilePreviewPanel } from '../preview/FilePreviewPanel'
import { FileTree } from './FileTree'
import { useAppStore } from '../../stores/appStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { useFilePreviewStore } from '../../stores/filePreviewStore'
import { activateCodeProject } from '../../utils/codeProjectActions'
import { projectPathsEqual } from '../../utils/projectPaths'
import { ChatView } from '../chat/ChatView'

export function CodeWorkspace() {
  const workspaceDir = useAppStore((s) => s.codeWorkspaceDir)
  const codeProjects = useWorkspaceStore((s) => s.codeProjects)
  const activeCodeProjectId = useWorkspaceStore((s) => s.activeCodeProjectId)
  const activeCodeProject = codeProjects.find((project) => project.id === activeCodeProjectId) ?? null
  const addCodeProject = useWorkspaceStore((s) => s.addCodeProject)
  const preview = useFilePreviewStore((s) => s.preview)
  const closePreview = useFilePreviewStore((s) => s.closePreview)
  const [showFiles, setShowFiles] = useState(false)

  useEffect(() => {
    if (!activeCodeProject) return
    const state = useAppStore.getState()
    const sessionId = activeCodeProject.sessionId
    const needsSession = !sessionId || state.codeActiveSessionId !== sessionId
    const needsHistory = Boolean(sessionId) && !Object.prototype.hasOwnProperty.call(state.sessionMessages, sessionId!)
    if (workspaceDir !== activeCodeProject.path || needsSession || needsHistory) {
      activateCodeProject(activeCodeProject)
    }
  }, [activeCodeProject?.id])

  const openFolder = async () => {
    const selected = await openDialog({
      directory: true,
      multiple: false,
      title: 'Add codebase folder',
    })
    if (typeof selected !== 'string') return

    let project = useWorkspaceStore.getState().codeProjects.find((item) => projectPathsEqual(item.path, selected))
    if (!project) {
      const name = selected.split(/[/\\\\]/).filter(Boolean).pop() || 'Code project'
      const projectId = addCodeProject({ name, path: selected })
      project = useWorkspaceStore.getState().codeProjects.find((item) => item.id === projectId)
    }
    if (!project) return

    activateCodeProject(project)
    closePreview()
  }

  const workspaceName = activeCodeProject?.name ?? (workspaceDir
    ? workspaceDir.split(/[/\\\\]/).filter(Boolean).pop() || workspaceDir
    : 'No project')

  return (
    <div className="code-workspace h-full min-h-0 min-w-0 flex-1 flex flex-col overflow-hidden bg-bg text-text">
      <header className="h-12 shrink-0 border-b border-border bg-surface flex items-center px-4">
        <div className="h-6 w-px bg-[#e8e3de] mr-3" />

        <div className="flex items-center gap-2 min-w-0">
          <div className="h-7 w-7 rounded-md bg-[#f3eee9] grid place-items-center text-[#d97745]">
            <FileCode2 size={15} />
          </div>
          <div className="min-w-0">
            <div className="text-[12px] font-semibold truncate">{workspaceName}</div>
            {workspaceDir && (
              <div className="text-[9px] text-[#9a938c] truncate max-w-[420px]">
                {workspaceDir}
              </div>
            )}
          </div>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <button
            onClick={() => setShowFiles((open) => !open)}
            disabled={!workspaceDir}
            className={`h-8 px-2.5 rounded-md border text-[11px] flex items-center gap-1.5 disabled:opacity-40 ${showFiles ? 'border-[#d8c5b5] bg-[#f6eee7] text-[#9b562f]' : 'border-[#e2ddd7] bg-white hover:bg-[#f5f2ef]'}`}
            title="Toggle project files"
          >
            <Files size={14} />
            Files
          </button>
          <button
            onClick={openFolder}
            className="h-8 px-2.5 rounded-md border border-[#e2ddd7] bg-white hover:bg-[#f5f2ef] text-[11px] flex items-center gap-1.5"
          >
            <FolderOpen size={14} />
            Open project
          </button>
        </div>
      </header>

      <main className="min-h-0 min-w-0 h-full flex-1 flex overflow-hidden bg-bg">
        {showFiles && workspaceDir && (
          <aside className="w-[260px] shrink-0 border-r border-[#e8e3de] bg-[#fcfbfa] flex flex-col">
            <div className="h-10 shrink-0 px-3 border-b border-[#eee9e4] flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-[.1em] text-[#8e877f]">Project files</span>
              <button onClick={() => setShowFiles(false)} className="h-6 w-6 rounded grid place-items-center hover:bg-[#f1eee9]" title="Close files"><X size={12}/></button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-2">
              <FileTree rootPath={workspaceDir} />
            </div>
          </aside>
        )}
        <section className="min-w-0 min-h-0 h-full flex-1 flex flex-col overflow-hidden relative">
          {!workspaceDir && (
            <div className="absolute inset-0 z-10 flex items-center justify-center px-6 bg-[#fcfbfa]">
              <div className="w-full max-w-[620px]">
                <div className="mb-7 text-center">
                  <div className="mx-auto mb-5 h-12 w-12 rounded-2xl border border-[#eee2d8] bg-white shadow-sm grid place-items-center text-[#d97745]">
                    <FileCode2 size={23}/>
                  </div>
                  <h1 className="text-[34px] leading-tight tracking-[-0.04em] font-serif text-[#201b17]">What are we building?</h1>
                  <p className="mt-2 text-[13px] text-[#8b837b]">Choose a project, then ask JCode to inspect, change, or build something.</p>
                </div>
                <div className="grid grid-cols-2 gap-3 mb-5">
                  <button onClick={openFolder} className="group rounded-xl border border-[#e6dfd8] bg-white p-4 text-left hover:border-[#d7b59e] hover:shadow-sm transition-all">
                    <div className="mb-3 h-9 w-9 rounded-lg bg-[#f8f1eb] text-[#c66d3c] grid place-items-center"><FolderOpen size={17}/></div>
                    <div className="text-[13px] font-semibold text-[#302c28]">Open a project</div>
                    <div className="mt-1 text-[11px] leading-relaxed text-[#8d857d]">Select a local folder to give JCode project context.</div>
                    <div className="mt-3 inline-flex items-center gap-1 text-[11px] font-medium text-[#a85d35]">Choose folder <ArrowUpRight size={12}/></div>
                  </button>
                  <button onClick={() => setShowFiles(true)} disabled={!workspaceDir} className="rounded-xl border border-[#e6dfd8] bg-white p-4 text-left hover:border-[#d7b59e] transition-all disabled:opacity-45">
                    <div className="mb-3 h-9 w-9 rounded-lg bg-[#f2f0ed] text-[#71675e] grid place-items-center"><Files size={17}/></div>
                    <div className="text-[13px] font-semibold text-[#302c28]">Browse project files</div>
                    <div className="mt-1 text-[11px] leading-relaxed text-[#8d857d]">Explore files and open one in the editor.</div>
                    <div className="mt-3 inline-flex items-center gap-1 text-[11px] font-medium text-[#756b62]">Open file tree <ArrowUpRight size={12}/></div>
                  </button>
                </div>
                <div className="flex items-center justify-center gap-2 text-[11px] text-[#a49b92]">
                  <GitBranch size={13}/> Your files stay local until JCode uses an enabled tool to read or edit them.
                </div>
              </div>
            </div>
          )}
          <div className={workspaceDir ? "min-h-0 flex-1 overflow-hidden" : "min-h-0 flex-1 overflow-hidden opacity-0 pointer-events-none"}>
            <ChatView embedded workspaceMode="code" />
          </div>
        </section>

        {preview && (
          <aside className="w-[460px] shrink-0 border-l border-[#e3dfda] bg-[#faf9f7] flex flex-col min-h-0">
            <div className="h-9 shrink-0 border-b border-[#e5e0da] bg-white px-3 flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <FileCode2 size={12} className="text-[#d97745]" />
                <span className="text-[10px] font-semibold truncate">{preview.fileName}</span>
              </div>
              <button
                onClick={closePreview}
                className="h-6 w-6 rounded hover:bg-[#f1eee9] grid place-items-center text-[#817a72]"
                title="Close file"
              >
                <X size={12} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              <FilePreviewPanel />
            </div>
          </aside>
        )}
      </main>
    </div>
  )
}
