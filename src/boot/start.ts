// Start gating: character art is requested only after the host page has painted and loaded,
// so it never competes with the page's own first paint.

const FCP_FALLBACK_MS = 5000;

function firstContentfulPaint(): Promise<void> {
  return new Promise((resolve) => {
    try {
      if (performance.getEntriesByType('paint').some((e) => e.name === 'first-contentful-paint')) return resolve();
      if (typeof PerformanceObserver === 'undefined' || !PerformanceObserver.supportedEntryTypes?.includes('paint')) {
        return void setTimeout(resolve, 200);
      }
      const timer = setTimeout(done, FCP_FALLBACK_MS);
      const po = new PerformanceObserver((list) => {
        if (list.getEntries().some((e) => e.name === 'first-contentful-paint')) done();
      });
      function done() {
        clearTimeout(timer);
        po.disconnect();
        resolve();
      }
      po.observe({ type: 'paint', buffered: true });
    } catch {
      setTimeout(resolve, 200);
    }
  });
}

function loaded(): Promise<void> {
  if (document.readyState === 'complete') return Promise.resolve();
  return new Promise((resolve) => window.addEventListener('load', () => resolve(), { once: true }));
}

function idle(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      if (typeof requestIdleCallback === 'function') requestIdleCallback(() => resolve(), { timeout: 1000 });
      else setTimeout(resolve, 200);
    });
  });
}

function visible(): Promise<void> {
  if (document.visibilityState !== 'hidden') return Promise.resolve();
  return new Promise((resolve) => {
    const on = () => {
      if (document.visibilityState === 'hidden') return;
      document.removeEventListener('visibilitychange', on);
      resolve();
    };
    document.addEventListener('visibilitychange', on);
  });
}

/** Resolves after first contentful paint, the load event, an animation frame and an idle period. */
export async function afterFirstPaint(signal?: AbortSignal): Promise<void> {
  await Promise.all([firstContentfulPaint(), loaded()]);
  await idle();
  await visible();
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
}
