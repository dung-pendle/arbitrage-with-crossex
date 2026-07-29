import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { installIntersectionObserverMock, MockIntersectionObserver } from './intersectionObserver';
import { server } from './server';

// jsdom has neither IntersectionObserver nor scrollIntoView — the section nav
// needs both. The IO mock records instances so tests can drive it manually.
installIntersectionObserverMock();
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

afterEach(() => {
  cleanup();
  server.resetHandlers();
  localStorage.clear(); // basket drafts / recent symbols / section state must not leak across tests
  MockIntersectionObserver.instances.length = 0;
});

afterAll(() => server.close());
