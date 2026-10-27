import type { ResolvedReview } from "@review-buddy/core/types";
import { useEffect, useState } from "react";
import { fetchReview } from "./api.ts";
import { ChapterReview } from "./components/ChapterReview.tsx";
import { Overview } from "./components/Overview.tsx";

type View = { mode: "overview" } | { mode: "chapter"; position: number };

export function App() {
  const [review, setReview] = useState<ResolvedReview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>({ mode: "overview" });

  useEffect(() => {
    fetchReview().then(setReview, (e) => setError(String(e)));
  }, []);

  if (error) {
    return (
      <div className="mx-auto max-w-xl p-10 text-center">
        <h1 className="mb-2 text-lg font-semibold">Couldn’t load the review</h1>
        <p className="font-mono text-sm text-muted-foreground">{error}</p>
      </div>
    );
  }

  if (!review) {
    return (
      <div className="grid h-full place-items-center text-muted-foreground">Loading review…</div>
    );
  }

  // Overview and ChapterReview are mutually exclusive branches, so returning
  // from a chapter always remounts Overview. That remount is what makes
  // Overview's mount-time readViewedEntries() snapshot sufficient — no live
  // subscription. See readViewedEntries in chapterFileSet.ts.
  if (view.mode === "chapter") {
    return (
      <ChapterReview
        review={review}
        position={view.position}
        onNavigate={(position) => setView({ mode: "chapter", position })}
        onExit={() => setView({ mode: "overview" })}
      />
    );
  }

  return (
    <Overview
      review={review}
      onBeginReview={(position) => setView({ mode: "chapter", position })}
    />
  );
}
