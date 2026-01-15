import { Component, ReactNode } from "react";
import { GlobalErrorView } from "./global-error-view";
import { logger } from "@/lib/logger-client";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class GlobalErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    logger.error(
      "[ReactError]",
      error.message,
      error.stack,
      errorInfo.componentStack
    );
  }

  handleDismiss = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError && this.state.error) {
      return (
        <GlobalErrorView
          message={this.state.error.message}
          stack={this.state.error.stack}
          onDismiss={this.handleDismiss}
        />
      );
    }

    return this.props.children;
  }
}
