import { AlertTriangle } from 'lucide-react';
import { Component, type ErrorInfo, type ReactNode } from 'react';

import i18n from '@/i18n';

import { Button } from './Button';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/** Catches render errors and shows a friendly message (in the current UI language). */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Render error', error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="mx-auto my-16 max-w-md px-4 text-center">
        <AlertTriangle className="mx-auto mb-4 h-10 w-10 text-accent" />
        <h1 className="mb-2 text-lg font-semibold">{i18n.t('errors.render_title')}</h1>
        <p className="mb-6 text-sm text-gray-600 dark:text-gray-400">
          {i18n.t('errors.render_body')}
        </p>
        <Button onClick={() => window.location.reload()}>{i18n.t('errors.reload')}</Button>
      </div>
    );
  }
}
