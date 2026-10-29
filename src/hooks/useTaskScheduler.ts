import { useEffect } from 'react'
import { useTaskStore } from '../stores'

/**
 * Keeps Orbito's local scheduler alive while the desktop app is running.
 * Task definitions and run history are persisted locally; execution uses
 * installed JCode through ACP rather than a legacy HTTP sidecar.
 */
export function useTaskScheduler() {
  const refresh = useTaskStore((s) => s.refresh)
  const tick = useTaskStore((s) => s.tick)
  const loading = useTaskStore((s) => s.loading)

  useEffect(() => {
    let tickInFlight = false
    let disposed = false

    // A task can take much longer than the 30-second polling interval. Never
    // allow a second scheduler pass to overlap an in-progress pass.
    const runTick = async () => {
      if (disposed || tickInFlight) return
      tickInFlight = true
      try {
        await tick()
      } catch (error) {
        console.error('[scheduler] Scheduled-task tick failed:', error)
      } finally {
        tickInFlight = false
      }
    }

    // Scheduler refresh/tick can touch SQLite and ACP. Delay it until the
    // initial workspace has had a chance to render and accept input.
    const startup = window.setTimeout(() => {
      if (disposed) return
      void refresh().catch((error) => {
        console.error('[scheduler] Could not refresh scheduled tasks:', error)
      })
      void runTick()
    }, 1200)
    const id = window.setInterval(() => { void runTick() }, 30_000)

    return () => {
      disposed = true
      window.clearTimeout(startup)
      window.clearInterval(id)
    }
  }, [refresh, tick])

  return { loading }
}
