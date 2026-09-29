"use client";

import dynamic from "next/dynamic";

import type { TradeBuilderProps } from "./trade-builder";

/** The builder reads local drafts, so it only renders in the browser. */
const TradeBuilder = dynamic(() => import("./trade-builder").then((m) => m.TradeBuilder), {
  ssr: false,
  loading: () => (
    <div className="grid gap-2" aria-busy="true" aria-label="Loading the trade builder">
      <div className="bg-muted h-24 w-full animate-pulse rounded" />
      <div className="bg-muted h-24 w-full animate-pulse rounded" />
    </div>
  ),
});

export function TradeBuilderClient(props: TradeBuilderProps) {
  return <TradeBuilder {...props} />;
}
