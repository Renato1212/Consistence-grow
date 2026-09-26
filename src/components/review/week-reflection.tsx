"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { SaveStatus } from "@/components/trade/save-status";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AutosaveController, browserStore, type AutosaveStatus } from "@/lib/autosave/controller";
import { logClientError } from "@/lib/client-errors";
import { slots } from "@/lib/review/debrief-form";
import { createClient } from "@/lib/supabase/client";

type Snap = { reflection: string; goals: string[] };

/** Weekly reflection + up to 3 goals for next week (shown on Today next week). Autosaved. */
export function WeekReflection({
  year,
  week,
  initial,
  updatedAt,
}: {
  year: number;
  week: number;
  initial: Snap;
  updatedAt: string | null;
}) {
  const storageKey = `cg:week:${year}-${week}`;
  const [start] = useState(() => {
    const raw = browserStore.get(storageKey);
    if (raw) {
      try {
        const rec = JSON.parse(raw) as { snapshot: Snap; at: number };
        if (!updatedAt || rec.at > Date.parse(updatedAt))
          return { snap: rec.snapshot, recovered: true };
      } catch {
        /* ignore corrupt copy */
      }
      browserStore.remove(storageKey);
    }
    return {
      snap: { reflection: initial.reflection, goals: slots(initial.goals) },
      recovered: false,
    };
  });
  const [snap, setSnap] = useState<Snap>(start.snap);
  const [status, setStatus] = useState<AutosaveStatus>(updatedAt ? "saved" : "idle");
  const [controller] = useState(() => {
    const supabase = createClient();
    return new AutosaveController<Snap>({
      storageKey,
      store: browserStore,
      save: async (s) => {
        const { error } = await supabase.from("weekly_reviews").upsert(
          {
            iso_year: year,
            iso_week: week,
            reflection: s.reflection.trim() || null,
            goals: s.goals
              .map((g) => g.trim())
              .filter(Boolean)
              .slice(0, 3),
            deleted_at: null,
          },
          { onConflict: "user_id,iso_year,iso_week" },
        );
        if (error) throw error;
      },
      onStatus: (st, err) => {
        setStatus(st);
        if (st === "error") logClientError("week.autosave", err, { year, week });
      },
    });
  });

  useEffect(() => {
    if (start.recovered) {
      controller.update(start.snap);
      toast.info("Restored unsaved weekly notes from this device");
    }
  }, [start, controller]);

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") void controller.flush();
    };
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (controller.hasUnsaved()) e.preventDefault();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("beforeunload", beforeUnload);
      void controller.flush();
      controller.dispose();
    };
  }, [controller]);

  const change = (patch: Partial<Snap>) => {
    const next = { ...snap, ...patch };
    setSnap(next);
    controller.update(next);
  };

  return (
    <section className="bg-card space-y-4 rounded-xl border p-4" aria-label="Reflection and goals">
      <div className="flex items-center gap-2">
        <h2 className="heading-caps text-xs">Reflection & next week</h2>
        <div className="ml-auto">
          <SaveStatus status={status} onRetry={() => void controller.retry()} />
        </div>
      </div>
      <Textarea
        aria-label="Weekly reflection"
        rows={5}
        placeholder="What did this week teach me?"
        value={snap.reflection}
        onChange={(e) => change({ reflection: e.target.value })}
      />
      <fieldset className="space-y-2">
        <legend className="mb-1.5 text-xs font-medium">
          Goals for next week (max 3 — shown on Today all next week)
        </legend>
        {snap.goals.map((g, i) => (
          <Input
            key={i}
            aria-label={`Goal ${i + 1}`}
            value={g}
            onChange={(e) => {
              const goals = [...snap.goals];
              goals[i] = e.target.value;
              change({ goals });
            }}
          />
        ))}
      </fieldset>
    </section>
  );
}
