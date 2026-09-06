import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from 'antd';

type AppErrorBoundaryProps = {
  children: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
};

type AppErrorBoundaryState = {
  hasError: boolean;
  error?: Error;
};

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Optional report hook placeholder: connect to a metrics/alerting sink here.
    this.props.onError?.(error, errorInfo);
  }

  private handleReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="app-error-boundary" role="alert" data-testid="app-error-boundary">
        <div className="app-error-boundary-card">
          <div className="app-error-boundary-title">页面渲染出错</div>
          <div className="app-error-boundary-summary">
            {this.state.error?.message || '应用发生了未知错误，请刷新页面重试。'}
          </div>
          <Button type="primary" onClick={this.handleReload}>
            刷新页面
          </Button>
        </div>
      </div>
    );
  }
}
