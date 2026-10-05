"use client";

import { useEffect, useState } from "react";

import type { AutosaveStatus } from "@/lib/autosave/controller";

type Run = () => PromiseLike<{ error: unknown }>;

/** Debounced writes keyed by what they save; the latest write per key wins. */
class SaveQueue {
  private queued = new Map<string, Run>();
  private failed = new Map<string, Run>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private busy = false;

  constructor(
    private readonly onStatus: (s: AutosaveStatus) => void,
    private readonly delayMs: number,
  ) {}

  get dirty() {
    return this.queued.size > 0 || this.failed.size > 0 || this.busy;
  }

  save = (key: string, run: Run, immediate = false) => {
    this.queued.set(key, run);
    this.failed.delete(key);
    this.onStatus("pending");
    this.schedule(immediate ? 0 : this.delayMs);
  };

  retry = () => {
    for (const [k, run] of this.failed) this.queued.set(k, run);
    this.failed.clear();
    void this.flush();
  };

  private schedule(ms: number) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), ms);
  }

  flush = async () => {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.busy) return this.schedule(200);
    const batch = [...this.queued.entries()];
    this.queued.clear();
    if (batch.length === 0) return;
    this.busy = true;
    this.onStatus("saving");
    const results = await Promise.all(
      batch.map(async ([key, run]) => {
        try {
          const { error } = await run();
          return { key, run, error };
        } catch (error) {
          return { key, run, error };
        }
      }),
    );
    this.busy = false;
    for (const r of results) {
      if (!r.error) this.failed.delete(r.key);
      else {
        console.error("save failed", r.key, r.error);
        if (!this.queued.has(r.key)) this.failed.set(r.key, r.run);
      }
    }
    if (this.queued.size > 0) {
      this.onStatus("pending");
      this.schedule(this.delayMs);
    } else this.onStatus(this.failed.size > 0 ? "error" : "saved");
  };
}

/**
 * One visible save status for a whole screen: pending → saving → saved, or
 * error with retry. Leaving the page with unsaved work asks first; leaving
 * within the app sends what is still waiting.
 */
export function useSaveQueue(delayMs = 800) {
  const [status, setStatus] = useState<AutosaveStatus>("idle");
  const [queue] = useState(() => new SaveQueue(setStatus, delayMs));

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (queue.dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
      void queue.flush();
    };
  }, [queue]);

  return { status, save: queue.save, retry: queue.retry, flush: queue.flush };
}
