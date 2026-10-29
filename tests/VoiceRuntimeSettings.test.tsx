// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { VoiceRuntimeSettings } from '../src/components/settings/VoiceRuntimeSettings'

const readyStatus = {
  assets: [
    {
      kind: 'streaming-asr',
      name: 'Streaming ASR',
      installed: true,
      downloadInProgress: false,
      diskBytes: 1,
    },
    {
      kind: 'vad',
      name: 'VAD',
      installed: true,
      downloadInProgress: false,
      diskBytes: 1,
    },
    {
      kind: 'tts',
      name: 'Built-in Rust neural TTS (Kokoro-82M INT8)',
      installed: true,
      downloadInProgress: false,
      diskBytes: 0,
    },
  ],
  speaking: false,
  listening: false,
}

describe('VoiceRuntimeSettings built-in TTS', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset()
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === 'get_voice_runtime_status') return readyStatus
      if (command === 'speak_text') return 1
      return undefined
    })
  })

  it('exposes a single built-in neural voice and can test playback', async () => {
    render(<VoiceRuntimeSettings />)

    expect(await screen.findByText(/Built-in offline neural speech synthesis/i)).toBeTruthy()
    expect(screen.queryByLabelText(/Speech engine/i)).toBeNull()
    expect(screen.queryByRole('radiogroup', { name: /Voice library/i })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /Test voice/i }))
    await waitFor(() => {
      expect(vi.mocked(invoke)).toHaveBeenCalledWith(
        'speak_text',
        expect.objectContaining({
          text: expect.stringContaining('Orbito'),
        }),
      )
    })
  })
})
