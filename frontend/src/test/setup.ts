import "@testing-library/jest-dom";

// Mock ResizeObserver for @tanstack/react-virtual in jsdom
// jsdom doesn't implement ResizeObserver, which the virtualizer uses
// to measure container dimensions.
class ResizeObserverMock {
  callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;
}
