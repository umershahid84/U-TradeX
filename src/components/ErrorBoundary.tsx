import React from 'react';
import './ErrorBoundary.css';

interface Props {
  /** Shown in the message, e.g. "the chart" */
  label: string;
  /** When this changes the boundary tries again (e.g. a new symbol) */
  resetKey?: string;
  /** Local-storage keys that "Reset settings" clears */
  settingsKeys?: string[];
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

/** Keeps one broken component from blanking the whole app */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(`Error in ${this.props.label}:`, error);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  private resetSettings = () => {
    try {
      (this.props.settingsKeys ?? []).forEach((k) => localStorage.removeItem(k));
    } catch {
      /* storage unavailable */
    }
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="error-boundary" role="alert">
        <strong>Something went wrong with {this.props.label}.</strong>
        <span className="eb-msg">{this.state.error.message}</span>
        <div className="eb-actions">
          <button type="button" onClick={() => this.setState({ error: null })}>Try again</button>
          {this.props.settingsKeys && (
            <button type="button" onClick={this.resetSettings}>Reset chart settings and reload</button>
          )}
        </div>
      </div>
    );
  }
}
