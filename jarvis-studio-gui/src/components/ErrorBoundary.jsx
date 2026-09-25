// ErrorBoundary — catches render/lifecycle throws anywhere below it so a single
// broken component degrades to a recoverable panel instead of a blank white
// screen. Class component because React only supports error boundaries via
// getDerivedStateFromError/componentDidCatch — there's no hook equivalent.
import { Component } from "react";

export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("[ErrorBoundary]", error, info?.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="crash-guard">
          <div className="crash-guard-box">
            <div className="crash-guard-ico">⚠</div>
            <div className="crash-guard-title">Something went wrong</div>
            <div className="crash-guard-msg">
              {this.state.error?.message || "An unexpected error occurred."}
            </div>
            <button className="crash-guard-btn" onClick={() => this.setState({ error: null })}>
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
