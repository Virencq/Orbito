export interface HighlightRequest {
  id: string
  code: string
  language: string
  theme: 'github-dark' | 'github-light'
}

export interface HighlightResponse {
  id: string
  html: string
}

let worker: Worker | null = null

function createWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./shiki.worker.ts', import.meta.url), { type: 'module' })
  }
  return worker
}

export async function highlightInWorker(request: HighlightRequest): Promise<HighlightResponse> {
  const currentWorker = createWorker()
  return new Promise((resolve, reject) => {
    const handler = (event: MessageEvent<HighlightResponse>) => {
      if (event.data.id === request.id) {
        currentWorker.removeEventListener('message', handler)
        currentWorker.removeEventListener('error', errorHandler)
        resolve(event.data)
      }
    }
    const errorHandler = (event: ErrorEvent) => {
      currentWorker.removeEventListener('message', handler)
      currentWorker.removeEventListener('error', errorHandler)
      reject(new Error(event.message || 'Syntax highlighting worker failed'))
    }
    currentWorker.addEventListener('message', handler)
    currentWorker.addEventListener('error', errorHandler)
    currentWorker.postMessage(request)
  })
}
