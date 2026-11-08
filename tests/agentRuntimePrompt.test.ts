import { describe, expect, it } from 'vitest'
import {
  assembleAgentRuntimePrompt,
  formatAgentSkillsBlock,
} from '../src/utils/agentRuntime'

describe('agent runtime prompt', () => {
  it('advertises skill metadata without embedding the full skill body', () => {
    const skills = formatAgentSkillsBlock([{
      name: 'review',
      description: 'Review code',
      content: 'Check correctness before answering.',
      location: 'skills/review/SKILL.md',
      enabled: true,
    }])

    const prompt = assembleAgentRuntimePrompt('## Identity\nYou are S-Loop.', skills)

    expect(prompt).toContain('## Identity')
    expect(prompt).toContain('## Available Skills')
    expect(prompt).toContain('review: Review code')
    expect(prompt).toContain('skills/review/SKILL.md')
    expect(prompt).toContain('open only that skill')
    expect(prompt).not.toContain('Check correctness before answering.')
  })

  it('does not emit an empty skills section', () => {
    expect(formatAgentSkillsBlock([])).toBeUndefined()
    expect(assembleAgentRuntimePrompt('base', undefined)).toBe('base')
  })
})
