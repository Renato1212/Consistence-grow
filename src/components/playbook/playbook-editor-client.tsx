"use client";

import dynamic from "next/dynamic";

/** Client-only: reads unsaved local changes on start (no hydration mismatch). */
export const PlaybookEditorClient = dynamic(
  () => import("./playbook-editor").then((m) => m.PlaybookEditor),
  {
    ssr: false,
    loading: () => (
      <div className="space-y-4" aria-busy="true" aria-label="Loading playbook">
        <div className="bg-muted h-8 w-48 animate-pulse rounded" />
        <div className="bg-muted h-64 w-full animate-pulse rounded-xl" />
      </div>
    ),
  },
);
