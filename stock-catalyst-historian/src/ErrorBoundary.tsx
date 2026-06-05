import React, { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children?: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  errorStr: string;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      errorStr: ""
    };
  }

  public static getDerivedStateFromError(error: Error): State {
    // Update state so the next render will show the fallback UI.
    return { hasError: true, errorStr: error.toString() };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="flex flex-col items-center justify-center p-8 m-4 bg-red-950/20 border-2 border-red-900 rounded-lg text-red-200 font-mono text-sm max-w-4xl mx-auto overflow-auto relative">
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            <span className="text-red-500 text-2xl">⚠️</span> Rendering Exception Triggered
          </h2>
          <pre className="p-4 bg-zinc-950 border border-zinc-800 rounded w-full whitespace-pre-wrap">{this.state.errorStr}</pre>
          <button 
             onClick={() => window.location.reload()} 
             className="mt-6 px-4 py-2 bg-red-600/20 border border-red-500 rounded hover:bg-red-600/40 transition-colors"
          >
             Re-Initialize Workspace
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
