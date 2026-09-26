"use client";

import dynamic from "next/dynamic";

import type { TradeEditorProps } from "./trade-editor";

/**
 * The editor generates the trade id, reads "now" and local drafts, so it only
 * renders in the browser (no hydration mismatch, no lost drafts).
 */
const TradeEditor = dynamic(() => import("./trade-editor").then((m) => m.TradeEditor), {
  ssr: false,
  loading: () => (
    <div className="mx-auto max-w-2xl space-y-4" aria-busy="true" aria-label="Loading trade form">
      <div className="bg-muted h-8 w-40 animate-pulse rounded" />
      <div className="bg-muted h-11 w-full animate-pulse rounded" />
      <div className="bg-muted h-11 w-full animate-pulse rounded" />
      <div className="bg-muted h-40 w-full animate-pulse rounded" />
    </div>
  ),
});

export function TradeEditorClient(props: TradeEditorProps) {
  return <TradeEditor {...props} />;
}
