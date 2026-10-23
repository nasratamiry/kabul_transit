import { QueryClient } from '@tanstack/react-query';

import { useAuth } from '@/stores/auth';

export const queryClient = new QueryClient({
  defaultOptions: {
    // The api client already retries once after a token refresh and toasts errors.
    queries: { retry: false, refetchOnWindowFocus: false, staleTime: 30_000 },
    mutations: { retry: false },
  },
});

// One user's cached data must never reach the next user who signs in on this browser.
useAuth.subscribe((state, prev) => {
  if (prev.user && state.user?.id !== prev.user.id) queryClient.clear();
});
