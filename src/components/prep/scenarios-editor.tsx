"use client";

import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Segmented } from "@/components/ui/segmented";
import { Textarea } from "@/components/ui/textarea";
import type { EditorInstrument, EditorPlaybook } from "@/lib/data/editor";
import { DOMAINS } from "@/lib/domains";
import type { ScenarioDraft } from "@/lib/prep/prep-form";

/** If → Then plans; marked played out / partial / didn't in the debrief. */
export function ScenariosEditor({
  scenarios,
  onChange,
  instruments,
  playbooks,
  defaultInstrumentId,
}: {
  scenarios: ScenarioDraft[];
  onChange: (s: ScenarioDraft[]) => void;
  instruments: EditorInstrument[];
  playbooks: EditorPlaybook[];
  defaultInstrumentId: string;
}) {
  const patch = (id: string, p: Partial<ScenarioDraft>) =>
    onChange(scenarios.map((s) => (s.id === id ? { ...s, ...p } : s)));
  return (
    <div className="space-y-3">
      {scenarios.length === 0 && <p className="text-muted-foreground text-sm">No scenarios yet.</p>}
      <ul className="space-y-3" data-testid="scenarios">
        {scenarios.map((s, i) => (
          <li
            key={s.id}
            data-testid="scenario-row"
            className="bg-background space-y-2 rounded-md border p-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="heading-caps text-muted-foreground text-[10px]">#{i + 1}</span>
              <div className="w-28">
                <NativeSelect
                  aria-label="Instrument"
                  value={s.instrumentId}
                  onChange={(e) => patch(s.id, { instrumentId: e.target.value })}
                >
                  <option value="">Any</option>
                  {instruments
                    .filter((x) => x.active || x.id === s.instrumentId)
                    .map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.symbol}
                      </option>
                    ))}
                </NativeSelect>
              </div>
              <Segmented
                label="Direction"
                size="sm"
                value={s.direction || null}
                onChange={(v) => patch(s.id, { direction: v === s.direction ? "" : v })}
                options={[
                  { value: "long", label: "Long" },
                  { value: "short", label: "Short" },
                ]}
              />
              <Button
                variant="ghost"
                size="icon"
                className="ml-auto"
                aria-label="Remove scenario"
                onClick={() => onChange(scenarios.filter((x) => x.id !== s.id))}
              >
                <Trash2 aria-hidden />
              </Button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Textarea
                aria-label="If…"
                placeholder="If… (condition)"
                rows={2}
                value={s.ifText}
                onChange={(e) => patch(s.id, { ifText: e.target.value })}
              />
              <Textarea
                aria-label="Then…"
                placeholder="Then… (plan)"
                rows={2}
                value={s.thenText}
                onChange={(e) => patch(s.id, { thenText: e.target.value })}
              />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <NativeSelect
                aria-label="Playbook"
                value={s.playbookId}
                onChange={(e) => patch(s.id, { playbookId: e.target.value })}
              >
                <option value="">No playbook</option>
                {playbooks.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </NativeSelect>
              <NativeSelect
                aria-label="Domain"
                value={s.domain}
                onChange={(e) => patch(s.id, { domain: e.target.value as ScenarioDraft["domain"] })}
              >
                <option value="">Domain…</option>
                {DOMAINS.map((d) => (
                  <option key={d.code} value={d.code}>
                    {d.label}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </li>
        ))}
      </ul>
      <Button
        variant="outline"
        size="sm"
        onClick={() =>
          onChange([
            ...scenarios,
            {
              id: crypto.randomUUID(),
              instrumentId: defaultInstrumentId,
              direction: "",
              ifText: "",
              thenText: "",
              playbookId: "",
              domain: "",
            },
          ])
        }
      >
        <Plus aria-hidden />
        Add scenario
      </Button>
    </div>
  );
}
