import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught component error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="w-full h-full min-h-screen flex flex-col items-center justify-center bg-surface-2 text-fg p-6">
          <div className="max-w-md bg-surface border border-line rounded p-6 text-center space-y-4">
            <div className="w-12 h-12 bg-amber-100 text-warning rounded-full flex items-center justify-center mx-auto">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <h2 className="text-lg font-bold text-fg">Application Rendering Notice</h2>
            <p className="text-xs text-fg-2">
              {this.state.error?.message || 'A render issue was intercepted.'}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-accent hover:bg-accent-hover text-white rounded text-xs font-semibold flex items-center justify-center gap-2 mx-auto transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reload OpenCFD Studio</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
