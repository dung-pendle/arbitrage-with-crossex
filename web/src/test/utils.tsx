import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { ToastProvider } from '../components/Toast';
import { TrackedAddressProvider } from '../panels/trackedAddress';
import { TradeFlowProvider } from '../trade/TradeFlow';

/** Render under a fresh QueryClient (no retries, no polling) + toast host +
 * the trade-flow modal host (fetches nothing until used, so monitoring-only
 * tests are unaffected) + the tracked-address store the positions view and the
 * settings drawer share. */
export function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchInterval: false, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <TradeFlowProvider>
          <TrackedAddressProvider>{ui}</TrackedAddressProvider>
        </TradeFlowProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}
