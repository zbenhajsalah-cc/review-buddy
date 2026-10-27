/** +additions / −deletions, monospace, muted. */
export function DiffStat({ additions, deletions }: { additions: number; deletions: number }) {
  return (
    <span className="font-mono text-xs">
      <span className="text-risk-low">+{additions}</span>{" "}
      <span className="text-risk-high">−{deletions}</span>
    </span>
  );
}
