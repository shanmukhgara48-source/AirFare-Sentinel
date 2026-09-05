import { Component, type ReactNode } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
}

export default class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true }
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="flex min-h-screen items-center justify-center bg-canvas p-6">
          <section
            className="w-full max-w-xl rounded-lg border border-line bg-surface p-8 text-center shadow-sm"
            role="alert"
          >
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
              Recoverable interface error
            </p>
            <h1 className="mt-2 font-serif text-[26px] text-ink">
              The dashboard could not render this view
            </h1>
            <p className="mx-auto mt-3 max-w-md text-[13px] leading-6 text-muted">
              No data was changed. Reload the interface to retry, or return to the
              overview after the API is available.
            </p>
            <button
              className="mt-6 rounded-md bg-accent px-4 py-2 text-[12px] font-semibold text-white"
              onClick={() => window.location.reload()}
              type="button"
            >
              Reload dashboard
            </button>
          </section>
        </main>
      )
    }

    return this.props.children
  }
}
