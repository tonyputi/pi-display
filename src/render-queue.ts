/**
 * Coalescing render queue: never runs two renders concurrently, and if new
 * renders are requested while one is in flight, it renders once more with the
 * latest state. Prevents interleaved writes from tearing hardware frames.
 */
export function createRenderQueue(render: () => Promise<void>): () => void {
  let running = false;
  let dirty = false;
  return () => {
    if (running) {
      dirty = true;
      return;
    }
    running = true;
    void (async () => {
      do {
        dirty = false;
        try {
          await render();
        } catch {
          // Render errors must not kill the queue.
        }
      } while (dirty);
      running = false;
    })();
  };
}
