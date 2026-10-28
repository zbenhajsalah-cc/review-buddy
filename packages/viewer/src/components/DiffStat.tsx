/** +additions / −deletions, monospace, muted. */
export function DiffStat({ additions, deletions }: { additions: number; deletions: number }) {
  return (
    <span className="shrink-0 whitespace-nowrap font-mono text-xs">
      <span className="text-risk-low">+{additions}</span>{" "}
      <span className="text-risk-high">−{deletions}</span>
    </span>
  );
}
