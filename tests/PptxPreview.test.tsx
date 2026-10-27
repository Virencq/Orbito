// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import JSZip from 'jszip'
import { PptxPreview } from '../src/components/preview/PptxPreview'
import { useFilePreviewStore } from '../src/stores/filePreviewStore'

const MINIMAL_SLIDE_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:sp>
        <p:txBody>
          <a:p xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
            <a:r><a:t>Hello fallback preview</a:t></a:r>
          </a:p>
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>`

async function makePptxBytes(): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<Types/>')
  zip.file('ppt/slides/slide1.xml', MINIMAL_SLIDE_XML)
  const arrayBuffer = await zip.generateAsync({ type: 'uint8array' })
  return arrayBuffer
}

function base64FromBytes(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

describe('PptxPreview', () => {
  const realFetch = globalThis.fetch

  beforeEach(() => {
    vi.mocked(invoke).mockReset()
    useFilePreviewStore.getState().closePreview()
  })

  afterEach(() => {
    globalThis.fetch = realFetch
    vi.restoreAllMocks()
  })

  it('uses local OOXML text extraction without a remote preview endpoint', async () => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch

    const bytes = await makePptxBytes()
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === 'read_file_base64') return base64FromBytes(bytes)
      return undefined
    })

    render(<PptxPreview filePath="C:/ws/decks/a.pptx" onLoaded={vi.fn()} onError={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByText(/Hello fallback preview/)).toBeTruthy()
    })
    expect(screen.getByText('1 / 1')).toBeTruthy()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
})
