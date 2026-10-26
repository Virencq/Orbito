import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowLeft, ChevronDown, Clock3, Folder, LockKeyhole, MessageSquare, Pencil, Pin, Plus, Send } from 'lucide-react'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { useAppStore } from '../../stores'
import { useWorkspaceStore, type CoworkProject } from '../../stores/workspaceStore'
import { useTaskStore } from '../../stores/taskStore'
import { readProjectInstructionFiles, saveProjectInstructionFile } from '../../utils/projectInstructionFiles'

interface ProjectDetailPageProps {
  project: CoworkProject
  onBack: () => void
  onStartChat: (prompt: string) => void
  onOpenSession: (sessionId: string) => void
  onOpenScheduled: () => void
}

export function ProjectDetailPage({ project, onBack, onStartChat, onOpenSession, onOpenScheduled }: ProjectDetailPageProps) {
  const [prompt, setPrompt] = useState('')
  const activeProject = useWorkspaceStore((s) => s.projects.find((item) => item.id === project.id) || project)
  const [editingInstructions, setEditingInstructions] = useState(false)
  const [instructions, setInstructions] = useState(project.instructions || '')
  const updateProject = useWorkspaceStore((s) => s.updateProject)
  const pinnedProjectIds = useWorkspaceStore((s) => s.pinnedProjectIds)
  const toggleProjectPin = useWorkspaceStore((s) => s.toggleProjectPin)
  const sessions = useAppStore((s) => s.sessions)
  const messages = useAppStore((s) => s.sessionMessages)
  const loadMessages = useAppStore((s) => s.loadMessages)
  const sessionIdsSignature = sessions.map((session) => session.id).join('|')
  useEffect(() => {
    // Older sessions did not store a project link. Load their messages once so
    // we can recover chats that mention this project's folder or name.
    for (const session of sessions) void loadMessages(session.id)
  }, [activeProject.id, sessionIdsSignature, loadMessages])

  useEffect(() => {
    let cancelled = false
    if (!activeProject.path || activeProject.instructions?.trim()) return
    void readProjectInstructionFiles(activeProject.path).then((files) => {
      if (cancelled || files.length === 0) return
      setInstructions(files[0].content)
    })
    return () => { cancelled = true }
  }, [activeProject.id, activeProject.path, activeProject.instructions])
  const tasks = useTaskStore((s) => s.tasks)
  const projectSessions = useMemo(() => {
    const normalize = (value: string) => value.split(String.fromCharCode(92)).join('/').toLowerCase()
    const projectPath = activeProject.path ? normalize(activeProject.path) : ''
    const pathTokens = normalize(activeProject.path || '').split('/').map((token) => token.toLowerCase()).filter((token) => token.length >= 4 && !['web_site', 'website', 'workspace', 'projects'].includes(token))
    const projectName = activeProject.name.toLowerCase()
    return sessions.filter((session) => {
      if (session.id === activeProject.sessionId || activeProject.sessionIds?.includes(session.id)) return true
      if (session.title?.toLowerCase().includes(projectName)) return true
      const userText = (messages[session.id] || [])
        .filter((message) => message.info.role === 'user')
        .flatMap((message) => message.parts.filter((part) => part.type === 'text').map((part) => 'text' in part ? part.text : ''))
        .join(' ').toLowerCase()
      if (!userText) return false
      if (projectPath && userText.includes(projectPath)) return true
      return pathTokens.some((token) => userText.includes(token)) && pathTokens.length > 0
    }).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8)
  }, [sessions, messages, activeProject.id, activeProject.sessionId, activeProject.sessionIds, activeProject.name, activeProject.path])
  const projectTasks = tasks.filter((task) => activeProject.path && task.workspaceDir && task.workspaceDir.replace(/\\/g, '/').toLowerCase() === activeProject.path.replace(/\\/g, '/').toLowerCase())

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const value = prompt.trim()
    if (!value) return
    onStartChat(value)
    setPrompt('')
  }

  return (
    <div className="flex min-h-0 flex-1 bg-[#171716] text-[#e9e7e2]">
      <section className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1120px] px-8 pb-10 pt-3">
          <div className="mb-9 flex items-center gap-3 text-[13px]">
            <button onClick={onBack} className="text-[#b8b5ae] hover:text-white">Projects</button>
            <span className="text-[#686761]">/</span>
            <span className="font-semibold text-[#f1efeb]">{activeProject.name}</span>
            <button onClick={onBack} className="ml-auto rounded-md p-1.5 text-[#9a978f] hover:bg-[#2a2a27] hover:text-white" title="Back to projects"><ArrowLeft size={15}/></button>
          </div>

          <div className="mb-8 flex items-center justify-between">
            <h1 className="truncate font-serif text-[28px] tracking-[-.025em] text-[#f1efeb]">{activeProject.name}</h1>
            <div className="flex items-center gap-2">
              <button onClick={() => toggleProjectPin(activeProject.id)} className="rounded-md p-2 text-[#c4c1ba] hover:bg-[#292926]" title="Update project"><Pin size={17} className={pinnedProjectIds.includes(activeProject.id) ? "fill-current" : ""}/></button>
              <button onClick={() => setEditingInstructions(true)} className="rounded-md p-2 text-[#c4c1ba] hover:bg-[#292926]" title="Edit project instructions"><Pencil size={16}/></button>
            </div>
          </div>

          <div className="grid grid-cols-[minmax(0,1fr)] gap-8 xl:grid-cols-[minmax(0,650px)]">
            <div>
              <form onSubmit={submit} className="overflow-hidden rounded-[20px] border border-[#454540] bg-[#20201e] shadow-[0_1px_0_rgba(255,255,255,.025)] focus-within:border-[#696963]">
                <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={2} placeholder="What would you like to work on in this project?" className="block min-h-[76px] w-full resize-none bg-transparent px-5 pt-5 text-[14px] leading-6 text-[#f0eee9] outline-none placeholder:text-[#89877f]" />
                <div className="flex h-12 items-center justify-between px-4 pb-1">
                  <div className="flex items-center gap-2 text-[#bdbab2]">
                    <button type="button" onClick={async () => { const selected = await openDialog({ directory: true, multiple: false, title: 'Add project context folder' }); if (typeof selected === 'string') useAppStore.getState().setWorkspaceDir(selected) }} className="rounded-md p-1.5 hover:bg-[#30302c]" title="Add context folder"><Plus size={18}/></button>
                    <button type="button" onClick={() => setEditingInstructions(true)} className="rounded-md p-1.5 hover:bg-[#30302c]" title="Project instructions"><Folder size={16}/></button>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[12px] font-semibold text-[#dedbd4]">JCode</span>
                    <span className="text-[12px] text-[#89877f]">Default</span>
                    <button type="submit" disabled={!prompt.trim()} className="grid h-8 w-8 place-items-center rounded-lg bg-[#2e2e2a] text-[#e9e7e2] hover:bg-[#41413b] disabled:opacity-40" title="Start project chat"><Send size={15}/></button>
                  </div>
                </div>
              </form>
              <div className="mt-3 flex items-center gap-2 px-4 text-[12px] text-[#8f8d85]">
                <Folder size={14}/><span className="max-w-[420px] truncate">{activeProject.path || activeProject.name}</span><ChevronDown size={13}/>
              </div>

              <div className="mt-8 flex items-center justify-between">
                <h2 className="text-[13px] font-medium text-[#aaa79f]">Recents</h2>
              </div>
              <div className="mt-2 divide-y divide-[#2c2c29]">
                {projectSessions.length ? projectSessions.map((session) => {
                  const lastUser = (messages[session.id] || []).filter((message) => message.info.role === 'user').slice(-1)[0]
                  const summary = lastUser?.parts.filter((part) => part.type === 'text').map((part) => 'text' in part ? part.text : '').join(' ').trim()
                  return <button key={session.id} onClick={() => onOpenSession(session.id)} className="flex w-full items-center gap-3 py-3 text-left hover:bg-[#1d1d1b]">
                    <MessageSquare size={15} className="shrink-0 text-[#89877f]"/>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-[#e1dfd9]">{session.title || 'New chat'}</span>
                      {summary && <span className="mt-1 block truncate text-[11px] text-[#89877f]">{summary}</span>}
                    </span>
                    <span className="shrink-0 text-[11px] text-[#89877f]">{new Date(session.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                  </button>
                }) : <div className="py-5 text-[12px] text-[#89877f]">Your recent chats in this project will appear here.</div>}
              </div>
            </div>
          </div>
        </div>
      </section>

      <aside className="hidden w-[352px] shrink-0 overflow-y-auto border-l border-[#33332f] bg-[#1c1c1a] lg:block">
        <div className="border-b border-[#33332f] px-5 py-4">
          <div className="flex items-center justify-between">
            <h2 className="text-[13px] font-semibold text-[#e9e7e2]">Instructions</h2>
            <button onClick={() => setEditingInstructions((v) => !v)} className="rounded-md p-1.5 text-[#b8b5ae] hover:bg-[#2d2d29]" title="Edit instructions"><Pencil size={14}/></button>
          </div>
          {editingInstructions ? <div className="mt-3">
            <textarea autoFocus value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="Add instructions to guide JCode on goals, style, constraints, and project conventions." className="min-h-[100px] w-full resize-y rounded-lg border border-[#3b3b36] bg-[#242422] p-3 text-[12px] leading-5 text-[#e9e7e2] outline-none focus:border-[#686860]"/>
            <div className="mt-2 flex justify-end gap-2"><button onClick={() => { setInstructions(project.instructions || ''); setEditingInstructions(false) }} className="rounded-md px-2 py-1 text-[11px] text-[#b8b5ae]">Cancel</button><button onClick={async () => { try { const value = instructions.trim(); if (activeProject.path) await saveProjectInstructionFile(activeProject.path, value); updateProject(activeProject.id, { instructions: value }); setEditingInstructions(false) } catch (error) { console.error('[Orbito] Could not save project instructions:', error); window.alert(`Could not save project instruction file: ${error instanceof Error ? error.message : String(error)}`) } }} className="rounded-md bg-[#393934] px-3 py-1 text-[11px] text-white">Save</button></div>
          </div> : <p className="mt-2 whitespace-pre-wrap text-[12px] leading-[1.55] text-[#a9a69e]">{project.instructions || 'Add instructions to guide JCode on goals, style, constraints, and project conventions.'}</p>}
        </div>

        <div className="border-b border-[#33332f] px-5 py-4">
          <div className="flex items-center justify-between"><h2 className="text-[13px] font-semibold text-[#e9e7e2]">Memory</h2><span className="inline-flex items-center gap-1 rounded-full border border-[#3b3b36] px-2 py-1 text-[10px] text-[#aaa79f]"><LockKeyhole size={10}/> Only you</span></div>
          <p className="mt-2 text-[12px] leading-5 text-[#a9a69e]">JCode manages persistent memory for its sessions. Use <span className="text-[#d7b39f]">/memory</span> in chat to inspect or change memory behavior.</p>
        </div>

        <div className="border-b border-[#33332f] px-5 py-4">
          <div className="flex items-center justify-between"><h2 className="text-[13px] font-semibold text-[#e9e7e2]">Context</h2><button onClick={async () => { const selected = await openDialog({ directory: true, multiple: false, title: 'Add project context folder' }); if (typeof selected === 'string') useAppStore.getState().setWorkspaceDir(selected) }} className="rounded-md p-1 text-[#b8b5ae] hover:bg-[#2d2d29]" title="Add context folder"><Plus size={15}/></button></div>
          <div className="mt-3 flex items-center gap-2 text-[12px] text-[#c7c4bc]"><Folder size={14} className="shrink-0 text-[#96938b]"/><span className="truncate">{project.path || 'No context folder selected'}</span></div>
        </div>

        <div className="px-5 py-4">
          <div className="flex items-center justify-between"><h2 className="text-[13px] font-semibold text-[#e9e7e2]">Scheduled</h2><button onClick={onOpenScheduled} className="rounded-md p-1 text-[#b8b5ae] hover:bg-[#2d2d29]" title="Manage scheduled tasks"><Plus size={15}/></button></div>
          {projectTasks.length ? projectTasks.slice(0, 5).map((task) => <button key={task.id} onClick={onOpenScheduled} className="mt-3 flex w-full items-start gap-2 text-left"><Clock3 size={13} className="mt-0.5 shrink-0 text-[#96938b]"/><span className="min-w-0 flex-1"><span className="block truncate text-[12px] text-[#e9e7e2]">{task.name}</span><span className="block text-[11px] text-[#96938b]">{task.enabled ? 'Active' : 'Paused'}</span></span></button>) : <p className="mt-2 text-[12px] leading-5 text-[#89877f]">No scheduled tasks linked to this project.</p>}
        </div>
      </aside>
    </div>
  )
}
