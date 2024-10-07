import React, { Component, ReactNode, useEffect } from 'react';
import { useLocation } from 'react-router-dom'; // Import useLocation from React Router
import { AlertTriangle } from 'lucide-react';

// Error fallback component
const ErrorFallback = ({ error, resetErrorBoundary }: { error: Error, resetErrorBoundary: () => void }) => (
  <div className="flex flex-col items-center justify-center h-[95%]">
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

// Wrapper Component to reset the boundary on navigation
const ErrorBoundaryWithNavigationReset = ({ children }: { children: ReactNode }) => {
  const location = useLocation();
  const [key, setKey] = React.useState(0);

  // Detect route changes and reset the error boundary
  useEffect(() => {
    setKey((prevKey) => prevKey + 1); // Change key on route change to reset the Error Boundary
  }, [location]);

  return <ErrorBoundaryWrapper key={key}>{children}</ErrorBoundaryWrapper>;
};

export default ErrorBoundaryWithNavigationReset;
