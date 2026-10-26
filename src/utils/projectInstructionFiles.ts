import { invoke } from '@tauri-apps/api/core'

export const PROJECT_INSTRUCTION_FILE_NAMES = ['AGENTS.md', 'CLAUDE.md', 'JCODE.md', 'jcode.md'] as const
export type ProjectInstructionFileName = typeof PROJECT_INSTRUCTION_FILE_NAMES[number]

function joinPath(directory: string, fileName: string): string {
  const separator = directory.includes('\\') ? '\\' : '/'
  return `${directory.replace(/[\\\\/]+$/, '')}${separator}${fileName}`
}

export interface ProjectInstructionFile {
  name: string
  path: string
  content: string
}

/**
 * Read every supported instruction file. Distinct files are retained even when
 * their contents differ so callers can show the sources and preserve each file.
 * Callers can de-duplicate prompt content separately while still showing every source.
 */
export async function readProjectInstructionFiles(directory: string): Promise<ProjectInstructionFile[]> {
  const results: ProjectInstructionFile[] = []
  const seenPaths = new Set<string>()
  for (const name of PROJECT_INSTRUCTION_FILE_NAMES) {
    const path = joinPath(directory, name)
    const normalizedPath = path.toLowerCase()
    if (seenPaths.has(normalizedPath)) continue
    seenPaths.add(normalizedPath)
    try {
      const content = await invoke<string>('read_text_file', { path })
      const normalizedContent = content.trim()
      if (normalizedContent) results.push({ name, path, content: normalizedContent })
    } catch {
      // Missing optional instruction files are expected.
    }
  }
  return results
}

/**
 * Save to an explicitly selected file when provided. Otherwise prefer the
 * shared AGENTS.md convention, then preserve an existing Claude/JCode file.
 */
export async function saveProjectInstructionFile(
  directory: string,
  content: string,
  selectedName?: string,
): Promise<ProjectInstructionFile> {
  const existing = await readProjectInstructionFiles(directory)
  const supportedName = selectedName && PROJECT_INSTRUCTION_FILE_NAMES.includes(selectedName as ProjectInstructionFileName)
    ? selectedName
    : undefined
  const targetName = supportedName
    ?? existing.find((file) => file.name.toLowerCase() === 'agents.md')?.name
    ?? existing.find((file) => file.name.toLowerCase() === 'claude.md')?.name
    ?? existing.find((file) => file.name.toLowerCase() === 'jcode.md')?.name
    ?? 'JCODE.md'
  const path = joinPath(directory, targetName)
  await invoke('write_text_file', { path, content })
  return { name: targetName, path, content }
}
