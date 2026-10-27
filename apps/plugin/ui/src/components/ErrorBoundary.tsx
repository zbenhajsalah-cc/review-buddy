import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

/** Last-resort guard: render errors show a readable panel, not a white page. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="mx-auto max-w-xl p-10 text-center">
          <h1 className="mb-2 text-lg font-semibold">Something went wrong rendering the review</h1>
          <p className="font-mono text-sm text-muted-foreground">{String(this.state.error)}</p>
        </div>
      );
    }
    return this.props.children;
  }
}
