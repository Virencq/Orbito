import { beforeEach, describe, expect, it, vi } from 'vitest'

const { listenMock, invokeMock, unlistenMock } = vi.hoisted(() => ({
  listenMock: vi.fn(),
  invokeMock: vi.fn(),
  unlistenMock: vi.fn(),
}))

vi.mock('@tauri-apps/api/event', () => ({ listen: listenMock }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))

describe('JCode prompt event lifecycle', () => {
  beforeEach(() => {
    listenMock.mockReset()
    invokeMock.mockReset()
    unlistenMock.mockReset()
  })

  it('returns an error when the event listener cannot be installed', async () => {
    invokeMock.mockResolvedValueOnce({ path: '.jcode/AGENTS.md', content: '' })
    listenMock.mockRejectedValueOnce(new Error('event bridge unavailable'))
    const { prompt } = await import('../src/utils/jcodeClient')

    await expect(prompt('acp-session', 'hello')).resolves.toMatchObject({
      text: '',
      error: 'event bridge unavailable',
    })
    expect(invokeMock).not.toHaveBeenCalledWith('jcode_prompt', expect.anything())
  })

  it('subscribes before prompting and releases the listener after completion', async () => {
    const order: string[] = []
    let handler: ((event: any) => void) | undefined
    listenMock.mockImplementation(async (_name: string, callback: (event: any) => void) => {
      order.push('listen')
      handler = callback
      return unlistenMock
    })
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'jcode_read_global_instructions') return { path: '.jcode/AGENTS.md', content: '' }
      if (command !== 'jcode_prompt') return undefined
      order.push('invoke')
      handler?.({
        payload: {
          sessionId: 'acp-session',
          event: { result: { stopReason: 'end_turn' } },
        },
      })
    })

    const { prompt } = await import('../src/utils/jcodeClient')
    await expect(prompt('acp-session', 'hello')).resolves.toMatchObject({ text: '' })

    expect(order).toEqual(['listen', 'invoke'])
    expect(invokeMock).toHaveBeenCalledWith('jcode_prompt', {
      sessionId: 'acp-session',
      prompt: 'hello',
    })
    expect(unlistenMock).toHaveBeenCalledTimes(1)
  })

  it('forwards image attachments to the ACP bridge', async () => {
    let handler: ((event: any) => void) | undefined
    listenMock.mockImplementation(async (_name: string, callback: (event: any) => void) => {
      handler = callback
      return unlistenMock
    })
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'jcode_read_global_instructions') return { path: '.jcode/AGENTS.md', content: '' }
      if (command !== 'jcode_prompt') return undefined
      handler?.({
        payload: {
          sessionId: 'acp-session',
          event: { result: { stopReason: 'end_turn' } },
        },
      })
    })

    const { prompt } = await import('../src/utils/jcodeClient')
    const images = [{ data: 'ZmFrZQ==', mimeType: 'image/png' }]
    await prompt('acp-session', 'Describe this image', { images })

    expect(invokeMock).toHaveBeenCalledWith('jcode_prompt', {
      sessionId: 'acp-session',
      prompt: 'Describe this image',
      images,
    })
  })

  it('resolves with an error when the ACP session closes before completion', async () => {
    let handler: ((event: any) => void) | undefined
    listenMock.mockImplementation(async (_name: string, callback: (event: any) => void) => {
      handler = callback
      return unlistenMock
    })
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'jcode_read_global_instructions') return { path: '.jcode/AGENTS.md', content: '' }
      if (command !== 'jcode_prompt') return undefined
      handler?.({
        payload: {
          sessionId: 'acp-session',
          event: { method: 'session/closed' },
        },
      })
    })

    const { prompt } = await import('../src/utils/jcodeClient')
    await expect(prompt('acp-session', 'hello')).resolves.toMatchObject({
      text: '',
      error: 'JCode ACP session closed before the prompt completed.',
    })
    expect(unlistenMock).toHaveBeenCalledTimes(1)
  })
})
