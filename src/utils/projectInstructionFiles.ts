import { invoke } from '@tauri-apps/api/core'

const INSTRUCTION_FILES = ['AGENTS.md', 'CLAUDE.md', 'JCODE.md'] as const

function joinPath(directory: string, fileName: string): string {
  const separator = directory.includes('\\\\') ? '\\\\' : '/'
  return `${directory.replace(/[\\\\/]+$/, '')}${separator}${fileName}`
}

export interface ProjectInstructionFile {
  name: string
  path: string
  content: string
}

/** Read supported project instruction files without requiring a particular agent runtime. */
export async function readProjectInstructionFiles(directory: string): Promise<ProjectInstructionFile[]> {
  const results: ProjectInstructionFile[] = []
  const seen = new Set<string>()
  for (const name of INSTRUCTION_FILES) {
    const path = joinPath(directory, name)
    try {
      const content = await invoke<string>('read_text_file', { path })
      if (content.trim() && !seen.has(content.trim())) {
        seen.add(content.trim())
        results.push({ name, path, content: content.trim() })
      }
    } catch {
      // Missing optional instruction files are expected.
    }
  }
  return results
}

/** Save to the existing shared/legacy file when present; otherwise create JCODE.md. */
export async function saveProjectInstructionFile(directory: string, content: string): Promise<ProjectInstructionFile> {
  const existing = await readProjectInstructionFiles(directory)
  const targetName = existing.find((file) => file.name === 'AGENTS.md')?.name
    ?? existing.find((file) => file.name === 'CLAUDE.md')?.name
    ?? existing.find((file) => file.name === 'JCODE.md')?.name
    ?? 'JCODE.md'
  const path = joinPath(directory, targetName)
  await invoke('write_text_file', { path, content })
  return { name: targetName, path, content }
}
