type Handler = (detail?: unknown) => void;

/** Tiny page-local event emitter. Handler errors are contained and never reach the caller. */
export class Emitter {
  private readonly handlers = new Map<string, Set<Handler>>();

  on(name: string, fn: Handler): () => void {
    if (typeof fn !== 'function') return () => {};
    let set = this.handlers.get(name);
    if (!set) this.handlers.set(name, (set = new Set()));
    set.add(fn);
    return () => set!.delete(fn);
  }

  emit(name: string, detail?: unknown): void {
    const set = this.handlers.get(name);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(detail);
      } catch (e) {
        setTimeout(() => {
          throw e;
        });
      }
    }
  }

  clear(): void {
    this.handlers.clear();
  }
}
