"use client";

import dynamic from "next/dynamic";

import type { DebriefPageData } from "@/lib/data/debrief";

/** Client-only: the editor reads unsaved local changes on start (no hydration mismatch). */
const DebriefEditor = dynamic(() => import("./debrief-editor").then((m) => m.DebriefEditor), {
  ssr: false,
  loading: () => (
    <div className="mx-auto max-w-3xl space-y-4" aria-busy="true" aria-label="Loading debrief">
      <div className="bg-muted h-8 w-48 animate-pulse rounded" />
      <div className="bg-muted h-32 w-full animate-pulse rounded-xl" />
      <div className="bg-muted h-48 w-full animate-pulse rounded-xl" />
    </div>
  ),
});

export function DebriefEditorClient({ data }: { data: DebriefPageData }) {
  return <DebriefEditor data={data} />;
}
