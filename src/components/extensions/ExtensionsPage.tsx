import { Puzzle } from 'lucide-react'

export function ExtensionsPage() {
  return (
    <div className="h-full overflow-auto bg-transparent px-8 py-16">
      <div className="mx-auto flex max-w-xl flex-col items-center rounded-2xl border border-border-light/50 bg-surface p-8 text-center">
        <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-surface-secondary text-text-tertiary">
          <Puzzle size={24} />
        </div>
        <h2 className="text-lg font-semibold text-text">Extensions are unavailable in this build</h2>
        <p className="mt-2 text-sm leading-relaxed text-text-secondary">
          This page previously depended on a separate local service that is not bundled with Orbito.
          The app will not call a hard-coded localhost port or report extension installs that did not happen.
        </p>
      </div>
    </div>
  )
}
