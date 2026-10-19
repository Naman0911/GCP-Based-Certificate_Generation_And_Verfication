import { Component, type ReactNode } from 'react'

interface State {
  failed: boolean
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div role="alert" className="mx-auto mt-24 max-w-md rounded-2xl border border-red-200 bg-white p-8 text-center shadow-sm">
        <h1 className="text-xl font-bold text-navy-900">Something went wrong</h1>
        <p className="mt-2 text-sm text-slate-600">An unexpected error occurred. Reloading the page usually fixes it.</p>
        <button type="button" className="mt-5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700" onClick={() => window.location.reload()}>
          Reload page
        </button>
      </div>
    )
  }
}
