import type { ResolvedReview } from "@review-buddy/core/types";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@review-buddy/viewer/ui";
import { useEffect, useId, useRef, useState } from "react";
import type { GitHubStatus, PostedReview, PostVerdict, ReviewBridge } from "../../shared/ipc.ts";
import { timeAgo } from "./RepoList.tsx";
import { ipcErrorMessage } from "./ReviewRun.tsx";

/** GitHub's limit for a review text (main checks it too). */
const MAX_BODY = 65_536;

export const VERDICTS: { verdict: PostVerdict; label: string; hint: string }[] = [
  { verdict: "approve", label: "Approve", hint: "The PR can be merged." },
  { verdict: "request_changes", label: "Request changes", hint: "Something must change first." },
  { verdict: "comment", label: "Comment", hint: "Only your text, no verdict." },
];

/** "Approved", "Changes requested", "Commented". */
export function postedLabel(verdict: PostVerdict): string {
  return verdict === "approve"
    ? "Approved"
    : verdict === "request_changes"
      ? "Changes requested"
      : "Commented";
}

/** The chapters as a Markdown list: title, risk, size. Never diff lines. */
export function chapterList(review: ResolvedReview): string {
  const lines = review.chapters.map((c, i) => {
    const files = `${c.fileCount} file${c.fileCount === 1 ? "" : "s"}`;
    return `${i + 1}. **${c.title.replace(/\s+/g, " ").trim()}** (${c.risk} risk, ${files}, +${c.additions} −${c.deletions})`;
  });
  return ["**Chapters** (from Review Buddy)", "", ...lines].join("\n");
}

/** Exactly the text that is posted: the summary, then the chapters if asked. */
export function postBody(summary: string, chapters: string | null): string {
  return [summary.trim(), chapters ?? ""].filter((part) => part !== "").join("\n\n");
}

/** Why this post cannot be sent as it is, or undefined. */
export function postProblem(
  verdict: PostVerdict,
  body: string,
  author: string | undefined,
  login: string | undefined,
): string | undefined {
  if (verdict !== "comment" && author && login && author.toLowerCase() === login.toLowerCase()) {
    return "This is your own PR: GitHub lets you only comment on it.";
  }
  if (verdict !== "approve" && body.trim() === "") {
    return verdict === "comment" ? "Write a comment first." : "Write what should change first.";
  }
  if (body.length > MAX_BODY) return `The text is too long for GitHub (${MAX_BODY} characters).`;
  return undefined;
}

/**
 * The bar above a review the reviewer marked done (US-17), with "Post to
 * GitHub…" (US-20) and what was posted last. Posting opens PostDialog.
 */
export function DoneBar({
  bridge,
  reviewKey,
  pr,
  doneAt,
  github,
  onPosted,
}: {
  bridge: ReviewBridge;
  reviewKey: string;
  /** `owner/repo#123`. */
  pr: string;
  doneAt: string;
  github: GitHubStatus | null;
  /** A review was posted (the PR list shows it). */
  onPosted?: () => void;
}) {
  const [posted, setPosted] = useState<PostedReview | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setPosted(null);
    bridge.posted(reviewKey).then(setPosted, () => {});
  }, [bridge, reviewKey]);
  const signedOut = github?.signedIn !== true;
  const now = Date.now();
  return (
    <>
      <div
        role="status"
        className="flex shrink-0 items-center gap-3 border-b bg-muted px-4 py-2 text-sm text-muted-foreground"
      >
        <span className="min-w-0 flex-1">
          You marked this review done {timeAgo(doneAt, now)}. Your viewed files are kept.
          {posted ? (
            <>
              {" "}
              {postedLabel(posted.verdict)} on GitHub {timeAgo(posted.postedAt, now)}
              {posted.login ? ` as @${posted.login}` : ""}:{" "}
              <a href={posted.url} target="_blank" rel="noreferrer" className="underline">
                view it
              </a>
              .
            </>
          ) : null}
        </span>
        <Button
          size="sm"
          variant={posted ? "outline" : "default"}
          disabled={signedOut}
          title={signedOut ? "Connect GitHub in Settings to post reviews." : undefined}
          onClick={() => setOpen(true)}
        >
          {posted ? "Post again…" : "Post to GitHub…"}
        </Button>
      </div>
      {open ? (
        <PostDialog
          bridge={bridge}
          reviewKey={reviewKey}
          pr={pr}
          login={github?.login}
          onClose={() => setOpen(false)}
          onPosted={(p) => {
            setPosted(p);
            setOpen(false);
            onPosted?.();
          }}
        />
      ) : null}
    </>
  );
}

/**
 * Write, then confirm: nothing is posted before "Post to GitHub" on the
 * confirm step, which shows the PR, the login, the verdict, the commit and
 * the exact text.
 */
export function PostDialog({
  bridge,
  reviewKey,
  pr,
  login,
  onClose,
  onPosted,
}: {
  bridge: ReviewBridge;
  reviewKey: string;
  pr: string;
  login: string | undefined;
  onClose: () => void;
  onPosted: (posted: PostedReview) => void;
}) {
  const titleId = useId();
  const [review, setReview] = useState<ResolvedReview | null>(null);
  const [verdict, setVerdict] = useState<PostVerdict>("approve");
  const [summary, setSummary] = useState("");
  const [withChapters, setWithChapters] = useState(false);
  const [step, setStep] = useState<"write" | "confirm">("write");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const first = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bridge.getReview(reviewKey).then(setReview, () => {});
  }, [bridge, reviewKey]);
  useEffect(() => first.current?.focus(), []);

  const author = review?.pr.author;
  // Your own PR: only Comment is possible.
  const own = !!author && !!login && author.toLowerCase() === login.toLowerCase();
  useEffect(() => {
    if (own) setVerdict("comment");
  }, [own]);

  const body = postBody(summary, withChapters && review ? chapterList(review) : null);
  const problem = postProblem(verdict, body, author, login);
  const headSha = /@([0-9a-f]+)$/.exec(reviewKey)?.[1]?.slice(0, 7);

  const post = async () => {
    setPosting(true);
    setError(undefined);
    try {
      const result = await bridge.post(reviewKey, { verdict, body });
      if (result.ok) onPosted(result.posted);
      else setError(result.error);
    } catch (e) {
      setError(ipcErrorMessage(e));
    } finally {
      setPosting(false);
    }
  };

  return (
    // The viewer's keyboard shortcuts listen on the document: keys typed here stop here.
    // biome-ignore lint/a11y/noStaticElementInteractions: a backdrop; Escape and the buttons close it
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 text-foreground"
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape" && !posting) onClose();
      }}
    >
      <Card role="dialog" aria-modal="true" aria-labelledby={titleId} className="w-full max-w-xl">
        <CardHeader>
          <CardTitle id={titleId}>
            {step === "write" ? `Post your review of ${pr}` : `Post this review to ${pr}?`}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {step === "write" ? (
            <>
              <fieldset className="space-y-1.5">
                <legend className="mb-1.5 font-medium">Your verdict</legend>
                {VERDICTS.map((v) => {
                  const disabled = own && v.verdict !== "comment";
                  return (
                    <label
                      key={v.verdict}
                      className={`flex items-baseline gap-2 ${disabled ? "opacity-50" : ""}`}
                      title={disabled ? "GitHub does not let you approve your own PR." : undefined}
                    >
                      <input
                        type="radio"
                        name="verdict"
                        value={v.verdict}
                        checked={verdict === v.verdict}
                        disabled={disabled}
                        onChange={() => setVerdict(v.verdict)}
                      />
                      <span className="font-medium">{v.label}</span>
                      <span className="text-muted-foreground">{v.hint}</span>
                    </label>
                  );
                })}
              </fieldset>
              <label className="block space-y-1.5">
                <span className="font-medium">
                  Summary{verdict === "approve" ? " (optional)" : ""}
                </span>
                <textarea
                  ref={first}
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  rows={5}
                  placeholder={
                    verdict === "request_changes"
                      ? "What should change?"
                      : "Your notes for the author (Markdown)"
                  }
                  className="w-full rounded-md border bg-background px-2.5 py-1.5 outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                />
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={withChapters}
                  disabled={!review}
                  onChange={(e) => setWithChapters(e.target.checked)}
                />
                Add the list of chapters (titles, risk and size)
              </label>
              {problem ? <p className="text-muted-foreground">{problem}</p> : null}
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={onClose}>
                  Cancel
                </Button>
                <Button disabled={!!problem} onClick={() => setStep("confirm")}>
                  Next: check and post
                </Button>
              </div>
            </>
          ) : (
            <>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                <dt className="text-muted-foreground">Verdict</dt>
                <dd className="font-medium">
                  {VERDICTS.find((v) => v.verdict === verdict)?.label}
                </dd>
                <dt className="text-muted-foreground">As</dt>
                <dd>{login ? `@${login}` : "your GitHub login"}</dd>
                <dt className="text-muted-foreground">On commit</dt>
                <dd className="font-mono text-xs leading-5">{headSha}</dd>
              </dl>
              <section aria-label="Text to post" className="space-y-1.5">
                <p className="text-muted-foreground">This exact text is posted:</p>
                <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted px-2.5 py-1.5 font-mono text-xs">
                  {body || "(no text)"}
                </pre>
              </section>
              <p className="text-muted-foreground">
                Everyone who can see the PR will see it. The app cannot take it back: change or
                dismiss it on GitHub.
              </p>
              {error ? (
                <p role="alert" className="whitespace-pre-wrap break-words text-destructive">
                  {error}
                </p>
              ) : null}
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  disabled={posting}
                  onClick={() => {
                    setError(undefined);
                    setStep("write");
                  }}
                >
                  Back
                </Button>
                <Button disabled={posting || !!problem} onClick={() => void post()}>
                  {posting ? "Posting…" : "Post to GitHub"}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
