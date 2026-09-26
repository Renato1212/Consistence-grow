"use client";

import dynamic from "next/dynamic";

import type { PrepPageData } from "@/lib/data/prep";

/** Client-only: the editor reads local unsaved changes on start (no hydration mismatch). */
const PrepEditor = dynamic(() => import("./prep-editor").then((m) => m.PrepEditor), {
  ssr: false,
  loading: () => (
    <div className="mx-auto max-w-3xl space-y-4" aria-busy="true" aria-label="Loading prep">
      <div className="bg-muted h-8 w-48 animate-pulse rounded" />
      <div className="bg-muted h-32 w-full animate-pulse rounded-xl" />
      <div className="bg-muted h-48 w-full animate-pulse rounded-xl" />
    </div>
  ),
});

export function PrepEditorClient({ data }: { data: PrepPageData }) {
  return <PrepEditor data={data} />;
}
