import type { CiCheck, ResolvedReview, VerificationCheck } from "@review-buddy/core/types";
import {
  AGENT_STATUS_LABEL,
  agentChecksInOrder,
  ciChecksToShow,
  hasNoEvidence,
  prChecksUrl,
  safeLink,
} from "../lib/evidence.ts";
import { cn } from "../lib/utils.ts";
import { Markdown } from "./Markdown.tsx";

const HEADING =
  "font-mono text-[0.66rem] font-medium uppercase tracking-[0.09em] text-muted-foreground";

/**
 * What was checked: the PR's CI (from GitHub, authoritative) and the checks
 * the agent says it ran (labelled as such: not proof). Review Buddy runs
 * nothing itself. With neither, one muted line says so: a hint to look harder.
 */
export function Evidence({ review }: { review: ResolvedReview }) {
  const { pr, verification } = review;
  const ci = pr.checks ?? [];
  const agentChecks = agentChecksInOrder(verification?.checks ?? []);
  const notCovered = verification?.not_covered?.trim();

  return (
    <section
      aria-labelledby="rb-evidence"
      className="mt-8 rounded-xl border border-border bg-card px-4 py-3.5"
    >
      <h2 id="rb-evidence" className={cn(HEADING, "mb-2")}>
        Evidence
      </h2>
      {hasNoEvidence(review) ? (
        <p className="text-sm text-muted-foreground">No checks were reported for this change.</p>
      ) : (
        <div className="space-y-3 text-sm">
          {ci.length > 0 && (
            <CiRow
              checks={ci}
              prUrl={pr.url}
              sha={pr.headRefOid}
              incomplete={pr.checksIncomplete === true}
            />
          )}
          {agentChecks.length > 0 && (
            <div>
              <h3 className="mb-1 text-xs font-medium text-muted-foreground">
                Reported by the agent
              </h3>
              <ul className="space-y-0.5">
                {agentChecks.map((c, i) => (
                  // Commands can repeat (run twice); the position keeps keys unique.
                  // biome-ignore lint/suspicious/noArrayIndexKey: a static list
                  <AgentCheck key={`${i}-${c.command}`} check={c} />
                ))}
              </ul>
            </div>
          )}
          {notCovered && (
            <div className="text-muted-foreground">
              <span className="font-medium text-foreground">Not covered: </span>
              <Markdown value={notCovered} variant="inline" className="inline" />
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function CiRow({
  checks,
  prUrl,
  sha,
  incomplete,
}: {
  checks: CiCheck[];
  prUrl?: string;
  sha?: string;
  incomplete: boolean;
}) {
  const shown = ciChecksToShow(checks);
  const passed = checks.filter((c) => c.status === "passed").length;
  const skipped = checks.filter((c) => c.status === "skipped").length;
  const all = prChecksUrl(prUrl);
  return (
    <div>
      <h3 className="mb-1 flex flex-wrap items-baseline gap-x-2 text-xs font-medium text-muted-foreground">
        <span>CI (GitHub)</span>
        {sha && <span className="font-mono font-normal">{sha.slice(0, 7)}</span>}
        {all && (
          <a
            href={all}
            target="_blank"
            rel="noreferrer"
            className="font-normal text-rb-link underline-offset-2 hover:underline"
          >
            All checks ↗
          </a>
        )}
      </h3>
      <ul className="space-y-0.5">
        {shown.map((c) => (
          <li key={`${c.status}-${c.name}`} className="flex items-baseline gap-2">
            <StatusMark status={c.status} />
            <CheckName name={c.name} url={safeLink(c.url)} />
            <span className="text-xs text-muted-foreground">{c.status}</span>
          </li>
        ))}
        {passed > 0 && (
          <li className="flex items-baseline gap-2">
            <StatusMark status="passed" />
            <span>
              {passed} passed{skipped > 0 && `, ${skipped} skipped`}
            </span>
          </li>
        )}
        {passed === 0 && skipped > 0 && (
          <li className="flex items-baseline gap-2 text-muted-foreground">
            <StatusMark status="skipped" />
            <span>{skipped} skipped</span>
          </li>
        )}
      </ul>
      {incomplete && (
        <p className="mt-1 text-xs text-risk-medium">
          Some checks could not be read, so this list may miss failures. Open all checks on GitHub.
        </p>
      )}
    </div>
  );
}

function AgentCheck({ check }: { check: VerificationCheck }) {
  return (
    <li className="flex items-baseline gap-2">
      <StatusMark status={check.status} />
      <code className="font-mono text-xs">{check.command}</code>
      <span className="text-xs text-muted-foreground">
        {check.summary ? check.summary : AGENT_STATUS_LABEL[check.status]}
      </span>
    </li>
  );
}

function CheckName({ name, url }: { name: string; url?: string }) {
  if (!url) return <span>{name}</span>;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="underline decoration-border underline-offset-2 hover:decoration-current"
    >
      {name}
    </a>
  );
}

const MARK: Record<
  CiCheck["status"] | VerificationCheck["status"],
  { glyph: string; label: string; className: string }
> = {
  passed: { glyph: "✓", label: "Passed", className: "text-risk-low" },
  failed: { glyph: "✗", label: "Failed", className: "text-risk-high" },
  pending: { glyph: "●", label: "Pending", className: "text-risk-medium" },
  skipped: { glyph: "–", label: "Skipped", className: "text-muted-foreground" },
  not_run: { glyph: "–", label: "Not run", className: "text-muted-foreground" },
};

function StatusMark({ status }: { status: keyof typeof MARK }) {
  const m = MARK[status];
  return (
    <span className={cn("w-3 shrink-0 text-center font-semibold", m.className)}>
      <span aria-hidden>{m.glyph}</span>
      <span className="sr-only">{m.label}:</span>
    </span>
  );
}
