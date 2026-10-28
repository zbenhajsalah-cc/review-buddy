/**
 * Asks before the tab closes (or reloads) while the review is not done: the
 * Claude Code hook holds the agent's turn until Done, and the viewer URL is
 * only in the hook's log, so a tab closed by mistake leaves the agent waiting.
 * Browsers show their own text; they ask only after the reviewer has used
 * the page.
 */
export function guardUnfinishedReview(finished: () => boolean): () => void {
  const onBeforeUnload = (event: BeforeUnloadEvent) => {
    if (finished()) return;
    event.preventDefault();
    // Older Chrome and Safari ask only when returnValue is set.
    event.returnValue = true;
  };
  window.addEventListener("beforeunload", onBeforeUnload);
  return () => window.removeEventListener("beforeunload", onBeforeUnload);
}
