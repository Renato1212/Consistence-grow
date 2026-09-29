"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, ArrowDown, ArrowUp, Merge, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { logClientError } from "@/lib/client-errors";
import type { AdminTag, AdminTagGroup } from "@/lib/data/taxonomy";
import { reorder } from "@/lib/settings/order";
import { createClient } from "@/lib/supabase/client";

const KINDS = ["context", "detail", "mistake", "emotion", "custom"] as const;
const KIND_LABEL: Record<(typeof KINDS)[number], string> = {
  context: "Context",
  detail: "Order flow / technical",
  mistake: "Mistakes",
  emotion: "Emotion / state",
  custom: "Custom",
};

type Err = { code?: string; message: string } | null;

/** Run a write, report failures calmly, refresh the page on success. */
function useWrite() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return {
    busy,
    async run(source: string, fn: () => PromiseLike<{ error: Err }>, ok?: () => void) {
      setBusy(true);
      try {
        const { error } = await fn();
        if (error) {
          if (error.code === "23505") toast.error("That name already exists here — merge instead.");
          else {
            logClientError(source, error);
            toast.error("Not saved — retry.");
          }
          return false;
        }
        ok?.();
        router.refresh();
        return true;
      } finally {
        setBusy(false);
      }
    },
  };
}

export function TagManager({ groups }: { groups: AdminTagGroup[] }) {
  const { busy, run } = useWrite();
  const [newGroup, setNewGroup] = useState("");
  const [newKind, setNewKind] = useState<(typeof KINDS)[number]>("custom");
  const allTags = groups.flatMap((g) => g.tags.map((t) => ({ ...t, group: g.name })));

  const moveGroup = (id: string, delta: -1 | 1) => {
    const changes = reorder(groups, id, delta);
    if (!changes.length) return;
    const supabase = createClient();
    void run("tags.order-groups", async () => {
      for (const c of changes) {
        const r = await supabase.from("tag_groups").update({ sort: c.sort }).eq("id", c.id);
        if (r.error) return r;
      }
      return { error: null };
    });
  };

  return (
    <div className="grid gap-4" data-testid="tag-manager">
      {groups.map((g, gi) => (
        <section
          key={g.id}
          className="bg-card rounded-xl border p-4"
          aria-label={`Group ${g.name}`}
        >
          <GroupHeader
            group={g}
            first={gi === 0}
            last={gi === groups.length - 1}
            onMove={(d) => moveGroup(g.id, d)}
          />
          <ul className="mt-3 divide-y">
            {g.tags.map((t, ti) => (
              <TagRow
                key={t.id}
                tag={t}
                group={g}
                groups={groups}
                others={allTags.filter((x) => x.id !== t.id)}
                first={ti === 0}
                last={ti === g.tags.length - 1}
              />
            ))}
            {g.tags.length === 0 && (
              <li className="text-muted-foreground py-2 text-sm">No tags in this group.</li>
            )}
          </ul>
          <AddTag group={g} />
        </section>
      ))}

      <form
        className="bg-card flex flex-wrap items-end gap-2 rounded-xl border p-4"
        onSubmit={(e) => {
          e.preventDefault();
          const name = newGroup.trim();
          if (!name) return;
          const sort = (groups.at(-1)?.sort ?? 0) + 10;
          void run(
            "tags.add-group",
            () => createClient().from("tag_groups").insert({ name, kind: newKind, sort }),
            () => {
              setNewGroup("");
              toast(`Group “${name}” added`);
            },
          );
        }}
      >
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground text-xs">New group</span>
          <Input
            value={newGroup}
            onChange={(e) => setNewGroup(e.target.value)}
            placeholder="e.g. Market structure"
            className="w-56"
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground text-xs">Kind</span>
          <NativeSelect
            value={newKind}
            onChange={(e) => setNewKind(e.target.value as (typeof KINDS)[number])}
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </NativeSelect>
        </label>
        <Button type="submit" disabled={busy || !newGroup.trim()}>
          <Plus aria-hidden />
          Add group
        </Button>
      </form>
    </div>
  );
}

function GroupHeader({
  group,
  first,
  last,
  onMove,
}: {
  group: AdminTagGroup;
  first: boolean;
  last: boolean;
  onMove: (delta: -1 | 1) => void;
}) {
  const { busy, run } = useWrite();
  const [name, setName] = useState(group.name);
  const saveName = () => {
    const v = name.trim();
    if (!v || v === group.name) return setName(group.name);
    void run("tags.rename-group", () =>
      createClient().from("tag_groups").update({ name: v }).eq("id", group.id),
    );
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        aria-label={`Name of group ${group.name}`}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={saveName}
        onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
        className="h-8 w-56 font-medium"
      />
      <NativeSelect
        aria-label={`Kind of group ${group.name}`}
        value={group.kind}
        disabled={busy}
        onChange={(e) =>
          void run("tags.group-kind", () =>
            createClient().from("tag_groups").update({ kind: e.target.value }).eq("id", group.id),
          )
        }
      >
        {KINDS.map((k) => (
          <option key={k} value={k}>
            {KIND_LABEL[k]}
          </option>
        ))}
      </NativeSelect>
      <div className="ml-auto flex items-center gap-1">
        <Button
          size="icon"
          variant="ghost"
          className="size-8"
          disabled={first || busy}
          onClick={() => onMove(-1)}
          aria-label={`Move group ${group.name} up`}
        >
          <ArrowUp aria-hidden />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="size-8"
          disabled={last || busy}
          onClick={() => onMove(1)}
          aria-label={`Move group ${group.name} down`}
        >
          <ArrowDown aria-hidden />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="size-8"
          disabled={group.tags.length > 0 || busy}
          title={group.tags.length ? "Move or delete its tags first" : "Delete group"}
          aria-label={`Delete group ${group.name}`}
          onClick={() =>
            void run(
              "tags.delete-group",
              () =>
                createClient()
                  .from("tag_groups")
                  .update({ deleted_at: new Date().toISOString() })
                  .eq("id", group.id),
              () =>
                toast(`Group “${group.name}” deleted`, {
                  action: {
                    label: "Undo",
                    onClick: () =>
                      void run("tags.undo-group", () =>
                        createClient()
                          .from("tag_groups")
                          .update({ deleted_at: null })
                          .eq("id", group.id),
                      ),
                  },
                }),
            )
          }
        >
          <Trash2 aria-hidden />
        </Button>
      </div>
    </div>
  );
}

function TagRow({
  tag,
  group,
  groups,
  others,
  first,
  last,
}: {
  tag: AdminTag;
  group: AdminTagGroup;
  groups: AdminTagGroup[];
  others: (AdminTag & { group: string })[];
  first: boolean;
  last: boolean;
}) {
  const { busy, run } = useWrite();
  const [name, setName] = useState(tag.name);
  const [mergeInto, setMergeInto] = useState("");
  const [confirmMerge, setConfirmMerge] = useState(false);
  const supabase = () => createClient();

  const saveName = () => {
    const v = name.trim();
    if (!v || v === tag.name) return setName(tag.name);
    void run("tags.rename", () =>
      supabase().from("tags").update({ name: v }).eq("id", tag.id),
    ).then((ok) => {
      if (!ok) setName(tag.name);
    });
  };

  const move = (delta: -1 | 1) => {
    const changes = reorder(group.tags, tag.id, delta);
    if (!changes.length) return;
    void run("tags.order", async () => {
      for (const c of changes) {
        const r = await supabase().from("tags").update({ sort: c.sort }).eq("id", c.id);
        if (r.error) return r;
      }
      return { error: null };
    });
  };

  const merge = () => {
    const target = others.find((o) => o.id === mergeInto);
    if (!target) return;
    let moved: { links: string[]; had_target: string[] } = { links: [], had_target: [] };
    void run(
      "tags.merge",
      async () => {
        const res = await supabase().rpc("merge_tags", { p_from: tag.id, p_into: target.id });
        if (!res.error) moved = res.data as typeof moved;
        return { error: res.error };
      },
      () => {
        setConfirmMerge(false);
        toast(`“${tag.name}” merged into “${target.name}” (${moved.links.length} trades)`, {
          action: {
            label: "Undo",
            onClick: () =>
              void run("tags.unmerge", () =>
                supabase().rpc("unmerge_tags", {
                  p_from: tag.id,
                  p_into: target.id,
                  p_links: moved.links,
                  p_had_target: moved.had_target,
                }),
              ),
          },
        });
      },
    );
  };

  return (
    <li className="flex flex-wrap items-center gap-2 py-2" data-tag={tag.name}>
      <Input
        aria-label={`Tag name ${tag.name}`}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={saveName}
        onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
        className="h-8 w-48"
      />
      <span className="text-muted-foreground num w-20 text-xs">
        {tag.trades} trade{tag.trades === 1 ? "" : "s"}
      </span>
      {tag.archived && <Badge variant="outline">archived</Badge>}
      <div className="ml-auto flex flex-wrap items-center gap-1">
        <NativeSelect
          aria-label={`Move tag ${tag.name} to group`}
          value={group.id}
          disabled={busy}
          className="h-8"
          onChange={(e) =>
            void run("tags.move", () =>
              supabase().from("tags").update({ group_id: e.target.value }).eq("id", tag.id),
            )
          }
        >
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label={`Merge tag ${tag.name} into`}
          value={mergeInto}
          className="h-8"
          onChange={(e) => {
            setMergeInto(e.target.value);
            setConfirmMerge(false);
          }}
        >
          <option value="">Merge into…</option>
          {others.map((o) => (
            <option key={o.id} value={o.id}>
              {o.group} · {o.name}
            </option>
          ))}
        </NativeSelect>
        {mergeInto && (
          <Button
            size="sm"
            variant={confirmMerge ? "default" : "outline"}
            onClick={() => (confirmMerge ? merge() : setConfirmMerge(true))}
          >
            <Merge aria-hidden />
            {confirmMerge ? "Confirm merge" : "Merge"}
          </Button>
        )}
        <Button
          size="icon"
          variant="ghost"
          className="size-8"
          disabled={first || busy}
          onClick={() => move(-1)}
          aria-label={`Move tag ${tag.name} up`}
        >
          <ArrowUp aria-hidden />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="size-8"
          disabled={last || busy}
          onClick={() => move(1)}
          aria-label={`Move tag ${tag.name} down`}
        >
          <ArrowDown aria-hidden />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="size-8"
          disabled={busy}
          title={tag.archived ? "Unarchive" : "Archive: hidden from pickers, kept in stats"}
          aria-label={`${tag.archived ? "Unarchive" : "Archive"} tag ${tag.name}`}
          onClick={() =>
            void run("tags.archive", () =>
              supabase()
                .from("tags")
                .update({ archived_at: tag.archived ? null : new Date().toISOString() })
                .eq("id", tag.id),
            )
          }
        >
          {tag.archived ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="size-8"
          disabled={busy}
          title="Delete: removed from pickers and stats (trash 30 days)"
          aria-label={`Delete tag ${tag.name}`}
          onClick={() =>
            void run(
              "tags.delete",
              () =>
                supabase()
                  .from("tags")
                  .update({ deleted_at: new Date().toISOString() })
                  .eq("id", tag.id),
              () =>
                toast(`Tag “${tag.name}” deleted`, {
                  action: {
                    label: "Undo",
                    onClick: () =>
                      void run("tags.undo-delete", () =>
                        supabase().from("tags").update({ deleted_at: null }).eq("id", tag.id),
                      ),
                  },
                }),
            )
          }
        >
          <Trash2 aria-hidden />
        </Button>
      </div>
    </li>
  );
}

function AddTag({ group }: { group: AdminTagGroup }) {
  const { busy, run } = useWrite();
  const [name, setName] = useState("");
  return (
    <form
      className="mt-2 flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const v = name.trim();
        if (!v) return;
        const sort = (group.tags.at(-1)?.sort ?? 0) + 10;
        void run(
          "tags.add",
          () => createClient().from("tags").insert({ name: v, group_id: group.id, sort }),
          () => setName(""),
        );
      }}
    >
      <Input
        aria-label={`New tag in ${group.name}`}
        placeholder="New tag"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="h-8 w-48"
      />
      <Button type="submit" size="sm" variant="outline" disabled={busy || !name.trim()}>
        <Plus aria-hidden />
        Add
      </Button>
    </form>
  );
}
