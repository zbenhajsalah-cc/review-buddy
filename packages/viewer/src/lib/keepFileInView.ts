const REVIEWER_EVENTS = ["wheel", "touchstart", "pointerdown", "keydown"] as const;

/**
 * Scroll a file's card (`[data-file-path]`) to the top of the diff pane, and
 * keep it there while the pane's content settles: the diffs render after
 * mount (highlighting runs in workers), so the cards above the file grow after
 * the first scroll and would push it out of view. Stops when the reviewer
 * takes over (wheel, touch, pointer, key) or after `maxMs`. Returns the stop
 * function.
 */
export function keepFileInView(scroller: HTMLElement, path: string, maxMs = 5000): () => void {
  const toFile = () =>
    scroller
      .querySelector(`[data-file-path="${CSS.escape(path)}"]`)
      ?.scrollIntoView({ block: "start" });
  toFile();
  const content = scroller.firstElementChild;
  if (!content) return () => {};

  const observer = new ResizeObserver(toFile);
  observer.observe(content);
  const timer = setTimeout(stop, maxMs);
  for (const type of REVIEWER_EVENTS) {
    window.addEventListener(type, stop, { capture: true, passive: true });
  }
  function stop() {
    observer.disconnect();
    clearTimeout(timer);
    for (const type of REVIEWER_EVENTS) window.removeEventListener(type, stop, { capture: true });
  }
  return stop;
}
