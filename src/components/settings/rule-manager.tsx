"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { logClientError } from "@/lib/client-errors";
import type { AdminRule } from "@/lib/data/taxonomy";
import { reorder } from "@/lib/settings/order";
import { createClient } from "@/lib/supabase/client";

export const RULE_CATEGORIES = ["general", "risk", "process", "execution", "mindset"];

/**
 * Trading rules checked in every prep and debrief. Inactive rules stay in the
 * history of past checks but are no longer asked.
 */
export function RuleManager({ rules }: { rules: AdminRule[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const [category, setCategory] = useState("general");

  async function run(source: string, fn: () => PromiseLike<{ error: unknown }>, ok?: () => void) {
    setBusy(true);
    const { error } = await fn();
    setBusy(false);
    if (error) {
      logClientError(source, error);
      toast.error("Not saved — retry.");
      return;
    }
    ok?.();
    router.refresh();
  }
  const rulesTable = () => createClient().from("rules");

  return (
    <div className="grid gap-3" data-testid="rule-manager">
      <ul className="bg-card divide-y rounded-xl border">
        {rules.map((r, i) => (
          <RuleRow
            key={r.id}
            rule={r}
            first={i === 0}
            last={i === rules.length - 1}
            busy={busy}
            onPatch={(patch) =>
              run("rules.update", () => rulesTable().update(patch).eq("id", r.id))
            }
            onMove={(d) => {
              const changes = reorder(rules, r.id, d);
              void run("rules.order", async () => {
                for (const c of changes) {
                  const res = await rulesTable().update({ sort: c.sort }).eq("id", c.id);
                  if (res.error) return res;
                }
                return { error: null };
              });
            }}
            onDelete={() =>
              run(
                "rules.delete",
                () => rulesTable().update({ deleted_at: new Date().toISOString() }).eq("id", r.id),
                () =>
                  toast("Rule deleted", {
                    action: {
                      label: "Undo",
                      onClick: () =>
                        void run("rules.undo", () =>
                          rulesTable().update({ deleted_at: null }).eq("id", r.id),
                        ),
                    },
                  }),
              )
            }
          />
        ))}
        {rules.length === 0 && <li className="text-muted-foreground p-4 text-sm">No rules yet.</li>}
      </ul>
      <form
        className="bg-card flex flex-wrap items-end gap-2 rounded-xl border p-4"
        onSubmit={(e) => {
          e.preventDefault();
          const v = text.trim();
          if (!v) return;
          const sort = (rules.at(-1)?.sort ?? 0) + 10;
          void run(
            "rules.add",
            () => rulesTable().insert({ text: v, category, sort }),
            () => setText(""),
          );
        }}
      >
        <label className="grid flex-1 gap-1 text-sm">
          <span className="text-muted-foreground text-xs">New rule</span>
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. No new trades after two losses in a row."
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground text-xs">Category</span>
          <NativeSelect value={category} onChange={(e) => setCategory(e.target.value)}>
            {RULE_CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </NativeSelect>
        </label>
        <Button type="submit" disabled={busy || !text.trim()}>
          <Plus aria-hidden />
          Add rule
        </Button>
      </form>
    </div>
  );
}

function RuleRow({
  rule,
  first,
  last,
  busy,
  onPatch,
  onMove,
  onDelete,
}: {
  rule: AdminRule;
  first: boolean;
  last: boolean;
  busy: boolean;
  onPatch: (patch: Partial<Pick<AdminRule, "text" | "category" | "active">>) => void;
  onMove: (delta: -1 | 1) => void;
  onDelete: () => void;
}) {
  const [text, setText] = useState(rule.text);
  // Optimistic: the box flips at once; the page refresh confirms it.
  const [active, setActive] = useState(rule.active);
  const categories = RULE_CATEGORIES.includes(rule.category)
    ? RULE_CATEGORIES
    : [...RULE_CATEGORIES, rule.category];
  return (
    <li className="flex flex-wrap items-center gap-2 p-3" data-rule={rule.text}>
      <Input
        aria-label={`Rule: ${rule.text}`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const v = text.trim();
          if (!v) return setText(rule.text);
          if (v !== rule.text) onPatch({ text: v });
        }}
        onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
        className={active ? "min-w-64 flex-1" : "text-muted-foreground min-w-64 flex-1"}
      />
      <NativeSelect
        aria-label={`Category of rule ${rule.text}`}
        value={rule.category}
        disabled={busy}
        onChange={(e) => onPatch({ category: e.target.value })}
      >
        {categories.map((c) => (
          <option key={c}>{c}</option>
        ))}
      </NativeSelect>
      <label className="flex items-center gap-1.5 text-sm">
        <input
          type="checkbox"
          checked={active}
          disabled={busy}
          onChange={(e) => {
            setActive(e.target.checked);
            onPatch({ active: e.target.checked });
          }}
          aria-label={`Ask rule “${rule.text}” in prep and debrief`}
        />
        Active
      </label>
      <Button
        size="icon"
        variant="ghost"
        className="size-8"
        disabled={first || busy}
        onClick={() => onMove(-1)}
        aria-label={`Move rule “${rule.text}” up`}
      >
        <ArrowUp aria-hidden />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="size-8"
        disabled={last || busy}
        onClick={() => onMove(1)}
        aria-label={`Move rule “${rule.text}” down`}
      >
        <ArrowDown aria-hidden />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="size-8"
        disabled={busy}
        onClick={onDelete}
        aria-label={`Delete rule “${rule.text}”`}
      >
        <Trash2 aria-hidden />
      </Button>
    </li>
  );
}
