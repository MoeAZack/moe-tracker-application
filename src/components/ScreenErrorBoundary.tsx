import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { reportDesktopDiagnostic } from '../utils/desktopDiagnostics';

type Props = { screen: string; children: React.ReactNode };
type State = { error: Error | null; code: string | null };

// One screen that throws while rendering must not blank the whole app. The
// boundary keeps the sidebar and every other screen working, tells the coach
// which screen failed, and records the error in the desktop crash log so a
// support bundle carries it.
// The repository has no React type package, so the inherited members this
// class uses are declared here.
export default class ScreenErrorBoundary extends React.Component<Props, State> {
  declare readonly props: Props;
  declare setState: (state: Partial<State>) => void;
  state: State = { error: null, code: null };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: error instanceof Error ? error : new Error(String(error || 'Unknown error')) };
  }

  componentDidCatch(error: unknown) {
    void reportDesktopDiagnostic(`screen-render:${this.props.screen}`, error).then(code => { if (code) this.setState({ code }); });
  }

  retry = () => this.setState({ error: null, code: null });

  render() {
    const { error, code } = this.state;
    if (!error) return this.props.children;
    return (
      <section role="alert" aria-label={`${this.props.screen} failed to load`} className="ui-card mx-auto my-12 max-w-xl rounded-2xl border border-amber-500/30 p-6 space-y-3">
        <div className="flex items-center gap-2 text-amber-300">
          <AlertTriangle className="w-5 h-5" aria-hidden="true" />
          <h2 className="text-base font-bold">{this.props.screen} could not be shown</h2>
        </div>
        <p className="text-sm text-gray-300">Your data is safe and every other screen still works. Choose another screen in the menu, or try this one again.</p>
        <p className="text-xs text-gray-500 break-words">{error.message}{code ? ` · Error code: ${code}` : ''}</p>
        <button type="button" onClick={this.retry} className="ui-button inline-flex items-center gap-2 px-3 py-2 text-sm font-semibold text-gray-200">
          <RefreshCw className="w-4 h-4" aria-hidden="true" /> Try again
        </button>
      </section>
    );
  }
}
