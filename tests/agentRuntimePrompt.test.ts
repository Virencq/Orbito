import { describe, expect, it } from 'vitest'
import {
  assembleAgentRuntimePrompt,
  formatAgentSkillsBlock,
} from '../src/utils/agentRuntime'

describe('agent runtime prompt', () => {
  it('includes only the body of a specifically requested skill', () => {
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
    expect(prompt).toContain('## Requested skill: review')
    expect(prompt).toContain('Check correctness before answering.')
    expect(prompt).not.toContain('Available Skills')
    
  })

  it('does not emit an empty skills section', () => {
    expect(formatAgentSkillsBlock([])).toBeUndefined()
    expect(assembleAgentRuntimePrompt('base', undefined)).toBe('base')
  })
})
