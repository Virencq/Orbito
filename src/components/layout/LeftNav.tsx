import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import {
  Archive, CalendarClock, ChevronRight, FolderKanban, FileCode2, Menu, Plus,
  Search, Settings, Sparkles, X, SlidersHorizontal, MoreHorizontal, Pin, Pencil,
  Trash2, MailOpen, Check,
} from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '../../stores'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { useFilePreviewStore } from '../../stores/filePreviewStore'
import { activateCodeProject } from '../../utils/codeProjectActions'
import { projectPathsEqual } from '../../utils/projectPaths'
import type { Page } from '../../types/navigation'

export function ResizeHandle({ side, onDrag }: { side: 'left' | 'right'; onDrag: (delta: number) => void }) {
  const previousX = useRef<number | null>(null)
  const activePointer = useRef<number | null>(null)

  const start = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    activePointer.current = e.pointerId
    previousX.current = e.clientX
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    if (activePointer.current !== e.pointerId || previousX.current === null) return
    const delta = e.clientX - previousX.current
    previousX.current = e.clientX
    if (delta !== 0) onDrag(side === 'left' ? delta : -delta)
  }
  const end = (e: React.PointerEvent<HTMLDivElement>) => {
    if (activePointer.current !== e.pointerId) return
    activePointer.current = null
    previousX.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
  }
  return <div
    onPointerDown={start}
    onPointerMove={move}
    onPointerUp={end}
    onPointerCancel={end}
    className={`absolute top-0 bottom-0 w-1 cursor-col-resize touch-none hover:bg-[#d97745]/25 z-30 ${side === 'left' ? 'right-0' : 'left-0'}`}
  />
}

export function LeftNav({ width, onWidth, page, onPage, onNew, onSettings, codeMode, onCode, onCowork }: {
  width: number; onWidth: (n: number) => void; page: Page; onPage: (p: Page) => void; onNew: () => void; onSettings: () => void; codeMode: boolean; onCode: () => void; onCowork: () => void
}) {
  const allSessions = useAppStore((s) => s.sessions)
  const codeSessionIds = useAppStore((s) => s.codeSessionIds)
  const streamingBySession = useAppStore(useShallow((s) => Object.fromEntries(s.sessions.map((session) => [session.id, !!s.streamingMessage[session.id]?.isStreaming]))))
  const coworkActiveSessionId = useAppStore((s) => s.activeSessionId)
  const codeActiveSessionId = useAppStore((s) => s.codeActiveSessionId)
  const codeProjects = useWorkspaceStore((s) => s.codeProjects)
  const activeCodeProjectId = useWorkspaceStore((s) => s.activeCodeProjectId)
  const addCodeProject = useWorkspaceStore((s) => s.addCodeProject)
  const updateCodeProject = useWorkspaceStore((s) => s.updateCodeProject)
  const removeCodeProject = useWorkspaceStore((s) => s.removeCodeProject)
  const [projectMenuId, setProjectMenuId] = useState<string | null>(null)
  const [renamingProjectId, setRenamingProjectId] = useState<string | null>(null)
  const [renameProjectValue, setRenameProjectValue] = useState('')
  const codeProjectSessionIds = codeProjects.flatMap((project) => project.sessionId ? [project.sessionId] : [])
  const sessions = codeMode
    ? allSessions.filter((s) => codeSessionIds.includes(s.id) || codeProjectSessionIds.includes(s.id))
    : allSessions.filter((s) => !codeSessionIds.includes(s.id) && !codeProjectSessionIds.includes(s.id))
  const activeSessionId = codeMode ? codeActiveSessionId : coworkActiveSessionId
  const setActiveSession = useAppStore((s) => s.setActiveSession)
  const setCodeActiveSessionId = useAppStore((s) => s.setCodeActiveSessionId)
  const updateSessionTitle = useAppStore((s) => s.updateSessionTitle)
  const deleteSession = useAppStore((s) => s.deleteSession)
  const [menuId, setMenuId] = useState<string | null>(null)
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 0 })
  const [searchOpen, setSearchOpen] = useState(false)
  const [filterPinned, setFilterPinned] = useState(false)
  const [taskQuery, setTaskQuery] = useState('')
  const [pinned, setPinned] = useState<Set<string>>(new Set())
  const [unread, setUnread] = useState<Set<string>>(new Set())
  const [archived, setArchived] = useState<Set<string>>(new Set())
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const allTasks = sessions
    .filter(s => !archived.has(s.id))
    .filter(s => !taskQuery || (s.title || '').toLowerCase().includes(taskQuery.toLowerCase()))
    .sort((a,b) => b.updatedAt-a.updatedAt)
  const tasks = allTasks.slice(0, 20)
  // Pinned is an independent collection: a pinned chat must remain visible
  // even when it is older than the 20 most-recent task rows.
  const pinnedTasks = allTasks.filter(s => pinned.has(s.id))
  const visibleTasks = filterPinned ? pinnedTasks : tasks

  useEffect(() => {
    if (!menuId) return
    const dismiss = (event: PointerEvent) => {
      if (!(event.target as HTMLElement).closest('[data-chat-menu]')) setMenuId(null)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuId(null)
    }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', escape)
    }
  }, [menuId])

  const beginRename = (id: string, title: string) => { setRenaming(id); setRenameValue(title); setMenuId(null) }
  const commitRename = (id: string) => {
    const title = renameValue.trim()
    if (title) updateSessionTitle(id, title)
    setRenaming(null)
  }

  const openCodeProject = (project: (typeof codeProjects)[number]) => {
    activateCodeProject(project)
    useFilePreviewStore.getState().closePreview()
    onPage('chat')
    setProjectMenuId(null)
  }

  const createCodeProject = async () => {
    const selected = await openDialog({ directory: true, multiple: false, title: 'Add codebase folder' })
    if (typeof selected !== 'string') return
    const existingProject = codeProjects.find((project) => projectPathsEqual(project.path, selected))
    if (existingProject) {
      openCodeProject(existingProject)
      return
    }
    const name = selected.split(/[\\/]/).filter(Boolean).pop() || 'Code project'
    const projectId = addCodeProject({ name, path: selected })
    const project = useWorkspaceStore.getState().codeProjects.find((item) => item.id === projectId)
    if (!project) return
    activateCodeProject(project)
    useFilePreviewStore.getState().closePreview()
    onPage('chat')
  }

  const commitProjectRename = (id: string) => {
    const name = renameProjectValue.trim()
    if (name) updateCodeProject(id, { name })
    setRenamingProjectId(null)
  }

  const deleteCodeProject = (project: (typeof codeProjects)[number]) => {
    if (!window.confirm('Delete "' + project.name + '" from Code projects and delete its chat history? The codebase folder and its files will remain untouched.')) return
    if (project.sessionId) useAppStore.getState().deleteSession(project.sessionId)
    const next = codeProjects.find((item) => item.id !== project.id)
    removeCodeProject(project.id)
    if (activeCodeProjectId === project.id) {
      if (next) {
        activateCodeProject(next)
      } else {
        useWorkspaceStore.getState().setActiveCodeProject(null)
        useAppStore.getState().setCodeWorkspaceDir(null)
        useAppStore.getState().setCodeActiveSessionId(null)
      }
      useFilePreviewStore.getState().closePreview()
    }
    setProjectMenuId(null)
  }

  return (
    <aside style={{ width }} className="relative shrink-0 h-full border-r border-border bg-surface pt-11 flex flex-col text-text">
      <ResizeHandle side="left" onDrag={(d) => onWidth(Math.max(176, Math.min(300, width + d)))} />

      <div className="px-1.5 pt-1 pb-1.5">
        <div className="grid grid-cols-2 h-7 rounded-md bg-surface-secondary p-0.5">
          <button onClick={onCowork} className={`rounded-md text-[13px] font-semibold transition-colors ${!codeMode ? 'bg-surface text-text shadow-sm' : 'text-text-secondary hover:text-text'}`}>Cowork</button>
          <button onClick={onCode} className={`rounded-md text-[13px] font-medium transition-colors ${codeMode ? 'bg-surface text-text shadow-sm' : 'text-text-secondary hover:text-text'}`}>‹/&gt;&nbsp; Code</button>
        </div>
      </div>

      <div className="px-1.5 pb-1.5">
        <button onClick={codeMode ? () => void createCodeProject() : onNew} className="w-full h-8 rounded-md border border-border bg-surface-secondary hover:bg-surface-hover text-text text-[13px] font-medium flex items-center gap-1.5 px-2.5">
          <Plus size={15}/> {codeMode ? 'Add codebase' : 'New'}
        </button>
      </div>

      {!codeMode ? (
        <nav className="px-1.5 space-y-0">
          <button onClick={() => onPage('projects')} className={`home-nav-row ${page === 'projects' ? 'bg-[#f0eeeb] text-[#302c28]' : ''}`}>
            <span className="inline-flex items-center gap-2"><FolderKanban size={14}/>Projects</span>
          </button>
          <button onClick={() => onPage('artifacts')} className={`home-nav-row ${page === 'artifacts' ? 'bg-[#f0eeeb] text-[#302c28]' : ''}`}>
            <span className="inline-flex items-center gap-2"><FileCode2 size={14}/>Artifacts</span>
          </button>
          <button onClick={() => { setFilterPinned(false); onPage('tasks') }} className={`home-nav-row ${page === 'tasks' && !filterPinned ? 'bg-[#f0eeeb] text-[#302c28]' : ''}`}>
            <span className="inline-flex items-center gap-2"><CalendarClock size={14}/>Scheduled</span><ChevronRight size={14}/>
          </button>
          <button onClick={() => onPage('customize')} className={`home-nav-row ${page === 'customize' ? 'bg-[#f0eeeb] text-[#302c28]' : ''}`}>
            <span className="inline-flex items-center gap-2"><Sparkles size={14}/>Customize</span>
          </button>
        </nav>
      ) : (
        <div className="mt-1.5 px-1.5">
          <div className="mb-2 flex items-center justify-between px-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-text-tertiary">
            <span>Code projects</span>
            <button onClick={() => void createCodeProject()} title="Add codebase folder" className="h-6 w-6 grid place-items-center rounded hover:bg-surface-hover text-text-secondary"><Plus size={14}/></button>
          </div>
          <div className="space-y-1 overflow-auto">
            {codeProjects.map((project) => (
              <div key={project.id} className="relative group">
                {renamingProjectId === project.id ? (
                  <div className="flex items-center gap-1 px-1 py-1">
                    <input autoFocus value={renameProjectValue} onChange={(e) => setRenameProjectValue(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') commitProjectRename(project.id); if (e.key === 'Escape') setRenamingProjectId(null) }}
                      className="min-w-0 flex-1 h-7 rounded-md border border-border px-2 text-[13px]" />
                    <button onClick={() => commitProjectRename(project.id)} className="h-7 w-7 grid place-items-center" title="Save name"><Check size={13}/></button>
                  </div>
                ) : (
                  <>
                    <button onClick={() => openCodeProject(project)}
                      className={`w-full rounded-md px-2 py-2.5 pr-9 text-left hover:bg-surface-hover ${activeCodeProjectId === project.id ? 'bg-[#f0eeeb]' : ''}`}>
                      <span className="flex items-center gap-2 text-[13px] font-medium text-[#514a43]">
                        <FolderKanban size={13} className="shrink-0 text-[#8f857b]"/><span className="truncate">{project.name}</span>
                      </span>
                      <span className="mt-0.5 block truncate pl-5 text-[9px] text-[#a49b92]">{project.path}</span>
                    </button>
                    <button onClick={() => setProjectMenuId(projectMenuId === project.id ? null : project.id)}
                      className="absolute right-1 top-1.5 h-7 w-7 rounded-md opacity-0 group-hover:opacity-100 hover:bg-surface-hover grid place-items-center" title="Project options"><MoreHorizontal size={14}/></button>
                    {projectMenuId === project.id && (
                      <div className="absolute right-1 top-9 z-50 w-40 rounded-xl border border-border bg-surface p-1.5 shadow-lg">
                        <button onClick={() => { setRenamingProjectId(project.id); setRenameProjectValue(project.name); setProjectMenuId(null) }} className="menu-row !h-7 !min-h-7 !gap-2 !rounded-md !px-2 !py-1 !text-[12px] !leading-4 !text-[#e8e6e3] hover:!bg-[#3a3a3a]"><Pencil size={14}/>Rename project</button>
                        <button onClick={() => deleteCodeProject(project)} className="menu-row !h-7 !min-h-7 !gap-2 !rounded-md !px-2 !py-1 !text-[12px] !leading-4 !text-[#f87171] hover:!bg-[#b91c1c] hover:!text-white"><Trash2 size={14}/>Delete project</button>
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
            {codeProjects.length === 0 && (
              <button onClick={() => void createCodeProject()} className="w-full rounded-md border border-dashed border-[#e3ddd6] px-3 py-3 text-left text-[13px] text-[#8f857b] hover:bg-[#f8f6f3]">+ Add a codebase folder</button>
            )}
          </div>
        </div>
      )}
      {!codeMode && (
        <>
        {/* Task navigation */}
        <div className="mt-2 px-2">
          <button onClick={() => setFilterPinned(v => !v)} className={`home-nav-row ${filterPinned ? 'bg-[#f0eeeb] text-[#302c28]' : ''}`}>
            <span className="inline-flex items-center gap-2"><Pin size={14}/>Pinned</span>
            <ChevronRight size={14}/>
          </button>
        </div>
  
        <div className="mt-1 px-1.5">
          <div className="flex items-center justify-between">
            <button onClick={() => onPage('tasks')} className="home-nav-row flex-1 !px-0"><span>Tasks</span><ChevronRight size={14}/></button>
            <div className="flex items-center gap-1 text-[#8f8983]">
              <button onClick={() => setSearchOpen(v => !v)} className={`title-icon !h-7 !w-7 ${searchOpen ? 'bg-[#f0eeeb] text-[#302c28]' : ''}`} title="Search tasks"><Search size={14}/></button>
              <button onClick={() => setFilterPinned(v => !v)} className={`title-icon !h-7 !w-7 ${filterPinned ? 'bg-[#f0eeeb] text-[#302c28]' : ''}`} title="Show pinned tasks"><SlidersHorizontal size={14}/></button>
            </div>
          </div>
          {searchOpen && (
            <input
              autoFocus
              value={taskQuery}
              onChange={e => setTaskQuery(e.target.value)}
              placeholder="Search tasks"
              className="mb-1 w-full h-8 rounded-md border border-[#e2ded9] bg-white px-3 text-[13px] outline-none focus:border-[#d97745]/50"
            />
          )}
        </div>
  
        <div className="px-1 mt-0.5 overflow-auto min-h-0 pb-28">
          {visibleTasks.map(s => (
            <div key={s.id} className="relative group">
              {renaming === s.id ? (
                <div className="flex items-center gap-1 px-2 py-1">
                  <input autoFocus value={renameValue} onChange={e=>setRenameValue(e.target.value)}
                    onKeyDown={e=>{if(e.key==='Enter')commitRename(s.id);if(e.key==='Escape')setRenaming(null)}}
                    className="min-w-0 flex-1 h-7 rounded-md border border-border bg-surface-secondary px-2 text-[13px] text-text"/>
                  <button onClick={()=>commitRename(s.id)} className="h-7 w-7 grid place-items-center"><Check size={13}/></button>
                </div>
              ) : (
                <>
                  <button onClick={()=>{onPage('chat');if(codeMode){setCodeActiveSessionId(s.id);useAppStore.getState().markCodeSession(s.id);void useAppStore.getState().loadMessages(s.id)}else{setActiveSession(s.id)}setUnread(p=>{const n=new Set(p);n.delete(s.id);return n})}}
                    className={`w-full text-left rounded-md px-2 py-1.5 text-[13px] leading-5 truncate text-text-secondary hover:bg-surface-hover hover:text-text ${activeSessionId===s.id?'bg-accent-subtle text-text':''}`}>
                    <span className="inline-flex items-center gap-1.5 max-w-full">
                      <span title={streamingBySession[s.id] ? 'Agent is working' : unread.has(s.id) ? 'Unread chat' : undefined} aria-label={streamingBySession[s.id] ? 'Agent is working' : unread.has(s.id) ? 'Unread chat' : 'Idle chat'} role={streamingBySession[s.id] ? 'status' : undefined} className={`h-1.5 w-1.5 rounded-full shrink-0 ${streamingBySession[s.id] ? 'bg-[#22c55e] ring-2 ring-[#22c55e]/20 animate-pulse' : unread.has(s.id) ? 'bg-[#3b82f6]' : 'border border-[#bcb6b0]'}`}/>
                      <span className="truncate">{s.title || 'Untitled task'}</span>
                    </span>
                  </button>
                  <button data-chat-menu onClick={e=>{
                    e.stopPropagation()
                    if (menuId === s.id) { setMenuId(null); return }
                    const rect = e.currentTarget.getBoundingClientRect()
                    const menuWidth = 176
                    const menuHeight = 190
                    setMenuPosition({
                      left: Math.max(8, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8)),
                      top: Math.max(8, Math.min(rect.bottom, window.innerHeight - menuHeight - 8)),
                    })
                    setMenuId(s.id)
                  }} className="absolute right-1 top-1.5 h-7 w-7 rounded-md opacity-0 group-hover:opacity-100 hover:bg-surface-hover grid place-items-center"><MoreHorizontal size={14}/></button>
                  {menuId===s.id && createPortal(
                    <div data-chat-menu style={{ position: 'fixed', left: menuPosition.left, top: menuPosition.top, width: 176, maxHeight: 'min(280px, calc(100vh - 16px))', overflowY: 'auto', backgroundColor: '#252525', borderColor: '#3c3c3c' }} className="z-[1000] rounded-xl border p-1 shadow-xl text-[#e8e6e3]">
                      <button onClick={()=>{
                        setPinned(p=>{
                          const n=new Set(p)
                          if (n.has(s.id)) n.delete(s.id); else n.add(s.id)
                          return n
                        })
                        setMenuId(null)
                      }} className="menu-row !h-7 !min-h-7 !gap-2 !rounded-md !px-2 !py-1 !text-[12px] !leading-4 !text-[#e8e6e3] hover:!bg-[#3a3a3a]"><Pin size={14}/>{pinned.has(s.id)?'Unpin':'Pin'}</button>
                      <button onClick={()=>beginRename(s.id,s.title)} className="menu-row"><Pencil size={14}/>Rename</button>
                      <button onClick={()=>{setUnread(p=>new Set(p).add(s.id));setMenuId(null)}} className="menu-row !h-7 !min-h-7 !gap-2 !rounded-md !px-2 !py-1 !text-[12px] !leading-4 !text-[#e8e6e3] hover:!bg-[#3a3a3a]"><MailOpen size={14}/>Mark as unread</button>
                      <div className="my-1 border-t border-[#414141]"/>
                      <button onClick={()=>{setArchived(p=>new Set(p).add(s.id));setMenuId(null)}} className="menu-row !h-7 !min-h-7 !gap-2 !rounded-md !px-2 !py-1 !text-[12px] !leading-4 !text-[#e8e6e3] hover:!bg-[#3a3a3a]"><Archive size={14}/>Archive</button>
                      <button onClick={()=>{deleteSession(s.id);setMenuId(null)}} className="menu-row text-[#b54d40]"><Trash2 size={14}/>Delete</button>
                    </div>,
                    document.body,
                  )}
                </>
              )}
            </div>
          ))}
          {visibleTasks.length===0 && <div className="px-3 py-3 text-[13px] text-text-tertiary">{filterPinned ? 'No pinned tasks' : 'No tasks yet'}</div>}
        </div>
  
        </>
      )}
      <div className="mt-auto border-t border-border px-1.5 py-1">
        <button onClick={onSettings} className="w-full flex items-center justify-between rounded-md px-1 py-1.5 text-left text-[10px] text-[#7d766f] hover:bg-surface-hover hover:text-[#302c28]" title="Open Settings">
          <span className="inline-flex items-center gap-2"><span className="h-4 w-4 rounded-full bg-surface-tertiary grid place-items-center text-[9px]">✦</span>Workspace</span>
          <Settings size={13}/>
        </button>
      </div>
    </aside>
  )
}

