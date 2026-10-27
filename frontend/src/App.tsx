import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router/dom';

import { ConfirmProvider } from '@/components/ui/ConfirmDialog';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { Toast } from '@/components/ui/Toast';
import { queryClient } from '@/lib/queryClient';
import { router } from '@/routes';

export default function App(): JSX.Element {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ConfirmProvider>
          <RouterProvider router={router} />
        </ConfirmProvider>
        <Toast />
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
