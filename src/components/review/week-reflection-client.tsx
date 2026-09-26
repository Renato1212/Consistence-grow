"use client";

import dynamic from "next/dynamic";

/** Client-only: reads unsaved local notes on start (no hydration mismatch). */
export const WeekReflectionClient = dynamic(
  () => import("./week-reflection").then((m) => m.WeekReflection),
  {
    ssr: false,
    loading: () => <div className="bg-muted h-56 animate-pulse rounded-xl" aria-busy="true" />,
  },
);
