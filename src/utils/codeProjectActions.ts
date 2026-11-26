import { useAppStore } from '../stores/appStore'
import { useWorkspaceStore, type CodeProject } from '../stores/workspaceStore'

/**
 * Make a Code project active and restore its dedicated chat.
 * This is the single entry point used by both the sidebar and Code workspace.
 */
export function activateCodeProject(project: CodeProject): string {
  const app = useAppStore.getState()
  const workspace = useWorkspaceStore.getState()

  if (workspace.activeCodeProjectId !== project.id) {
    workspace.setActiveCodeProject(project.id)
  }
  if (app.codeWorkspaceDir !== project.path) {
    app.setCodeWorkspaceDir(project.path)
  }

  if (project.sessionId) {
    if (app.codeActiveSessionId !== project.sessionId) {
      app.setCodeActiveSessionId(project.sessionId)
    }
    if (!app.codeSessionIds.includes(project.sessionId)) {
      app.markCodeSession(project.sessionId)
    }
    if (!Object.prototype.hasOwnProperty.call(app.sessionMessages, project.sessionId)) {
      void app.loadMessages(project.sessionId)
    }
    return project.sessionId
  }

  // Creating a chat from an explicit project activation is intentional.
  return app.createCodeSession(project.id)
}
