import { AlertTriangle } from 'lucide-react';
import React, { Component, ReactNode } from 'react';
import { useLocation } from 'react-router-dom'; // Import useLocation from React Router

// Error fallback component
const ErrorFallback = ({ error, resetErrorBoundary }: { error: Error, resetErrorBoundary: () => void }) => (
  <div className="flex flex-col items-center justify-center h-full">
    <div className="flex flex-col items-center p-6 bg-white rounded-lg shadow-lg">
      {/* Icon */}
      <AlertTriangle size={60} className="text-red-500 mb-4" />

      {/* Error Header */}
      <h2 className="text-2xl font-semibold text-gray-800 mb-2">Oops! Something went wrong.</h2>

      {/* Friendly Message */}
      <p className="text-gray-600 mb-4 text-center">
        An unexpected error has occurred in the application. Please try again or contact support if the problem persists.
      </p>

      {/* Error Message (Only in dev or detailed context) */}
      <details className="w-full mb-4 p-4 border border-gray-300 bg-gray-100 rounded-md">
        <summary className="cursor-pointer font-semibold text-gray-700">Show error details</summary>
        <pre className="whitespace-pre-wrap text-sm text-red-700 mt-2">{error.message}</pre>
      </details>

      {/* Action Buttons */}
      <div className="flex items-center justify-center">
        {/* <button
          onClick={resetErrorBoundary}
          className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-all"
        >
          Try Again
        </button> */}
        {/* <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 transition-all"
        >
          Reload Page
        </button> */}

        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-all"
        >
          Reload Page
        </button> 
      </div>
    </div>
  </div>
);

interface Props {
  children: ReactNode;
  /**
   * Opaque token identifying the current navigation. When it CHANGES while the boundary is
   * in its error state, the boundary clears that state so the newly-routed page gets a fresh
   * try. It must NEVER be used as a React `key` on this component -- see the note on
   * ErrorBoundaryWithNavigationReset below.
   */
  resetKey: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

// Main Error Boundary class
class ErrorBoundaryWrapper extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  // Clear a caught error when the app navigates, so a crashed screen does not stick around on
  // the next route. Gated on `hasError` -- on a healthy boundary this is a no-op, which is the
  // whole point: navigation must not disturb a subtree that never crashed.
  componentDidUpdate(prevProps: Props) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, error: null });
    }
  }

  resetErrorBoundary = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <ErrorFallback error={this.state.error!} resetErrorBoundary={this.resetErrorBoundary} />
      );
    }

    return this.props.children;
  }
}

/**
 * Wrapper Component to reset the boundary on navigation.
 *
 * This wraps <Outlet /> in MainLayout, so its child subtree is EVERY routed page in the app.
 *
 * DO NOT reset it by bumping a React `key` on ErrorBoundaryWrapper. A changing `key` is an
 * unmount+remount instruction, so that pattern tore down and rebuilt the whole routed page on
 * every navigation -- once on first mount (the effect fires on mount too) and again on every
 * location change, in production as well as dev. Two consequences it caused:
 *   - every page mounted, unmounted and remounted on load and on each navigation;
 *   - a same-route param change (e.g. the BoQ pricing editor's sheet-tab strip, which navigates
 *     /pricing/:sheetName -> /pricing/:otherSheet) destroyed all of that page's useState, even
 *     though React itself keeps the component mounted across a param change. That is what
 *     silently dropped the pricing editor out of full screen on a sheet switch.
 *
 * `resetKey` reproduces the old reset SEMANTICS without the remount: location.key is a fresh
 * value per history entry, so ANY navigation (including re-navigating to the same URL) clears a
 * crashed screen, while a healthy subtree is left completely alone. urlStateManager's raw
 * history.replaceState writes do not create a new location and so do not reset -- unchanged.
 */
const ErrorBoundaryWithNavigationReset = ({ children }: { children: ReactNode }) => {
  const location = useLocation();

  return <ErrorBoundaryWrapper resetKey={location.key}>{children}</ErrorBoundaryWrapper>;
};

export default ErrorBoundaryWithNavigationReset;
