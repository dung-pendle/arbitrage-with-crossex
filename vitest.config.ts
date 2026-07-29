import { defineConfig } from 'vitest/config';

// The `live` project places REAL orders on the user's Gate account. It is only
// collected when LIVE_TRADE_TESTS=1 (set by `yarn test:live`, never by `yarn test`),
// and its suite enforces further interlocks (see tests/live/guards.ts).
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/unit/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'server',
          environment: 'node',
          include: ['tests/server/**/*.test.ts'],
          setupFiles: ['tests/server/helpers/setup.ts'],
        },
      },
      {
        test: {
          name: 'live',
          environment: 'node',
          include: process.env.LIVE_TRADE_TESTS === '1' ? ['tests/live/**/*.test.ts'] : [],
          fileParallelism: false,
          testTimeout: 60_000,
          hookTimeout: 120_000,
          retry: 0,
        },
      },
    ],
  },
});
