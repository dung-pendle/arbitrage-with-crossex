/**
 * Manual-drive IntersectionObserver mock for jsdom (installed in setup.ts —
 * jsdom has no IO at all). Tests grab `MockIntersectionObserver.instances.at(-1)`
 * and call `trigger(...)` to simulate sections entering/leaving the viewport.
 */
export class MockIntersectionObserver implements IntersectionObserver {
  static instances: MockIntersectionObserver[] = [];

  readonly root: Element | Document | null = null;
  readonly rootMargin = '';
  readonly thresholds: readonly number[] = [];
  readonly elements = new Set<Element>();

  constructor(private readonly callback: IntersectionObserverCallback) {
    MockIntersectionObserver.instances.push(this);
  }

  observe(el: Element): void {
    this.elements.add(el);
  }

  unobserve(el: Element): void {
    this.elements.delete(el);
  }

  disconnect(): void {
    this.elements.clear();
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  /** Drive the callback with partial entries (target + isIntersecting suffice). */
  trigger(entries: Array<Pick<IntersectionObserverEntry, 'target' | 'isIntersecting'>>): void {
    this.callback(entries as IntersectionObserverEntry[], this);
  }
}

export function installIntersectionObserverMock(): void {
  globalThis.IntersectionObserver =
    MockIntersectionObserver as unknown as typeof IntersectionObserver;
}
