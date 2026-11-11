import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/globals.css";
import "./i18n";

class StartupErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="h-screen w-screen grid place-items-center bg-[#faf9f7] text-[#302c28] p-8">
        <div className="w-full max-w-lg rounded-2xl border border-[#e5e0da] bg-white p-6 shadow-sm">
          <h1 className="text-lg font-semibold">Orbito could not start</h1>
          <p className="mt-2 text-sm text-[#746c64]">
            The desktop UI hit an unexpected error. Restarting the window may recover it, but the error below is useful for fixing the underlying problem.
          </p>
          <pre className="mt-4 max-h-40 overflow-auto rounded-lg bg-[#f6f3f0] p-3 text-xs text-[#5f5851] whitespace-pre-wrap">{this.state.error.message}</pre>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-4 rounded-lg bg-[#302c28] px-4 py-2 text-xs font-semibold text-white hover:bg-black"
          >
            Reload Orbito
          </button>
        </div>
      </div>
    )
  }
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <StartupErrorBoundary>
      <App />
    </StartupErrorBoundary>
  </React.StrictMode>,
);
