import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { EmptyState } from "@/components/shell/empty-state";
import { TradeEditorClient } from "@/components/trade/editor-client";
import { Button } from "@/components/ui/button";
import { loadEditorData } from "@/lib/data/editor";
import { loadMedia } from "@/lib/data/media";
import { createClient } from "@/lib/supabase/server";
import { tradeRowToForm } from "@/lib/trading/trade-form";
import { Trash2 } from "lucide-react";

export const metadata: Metadata = { title: "Edit trade" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditTradePage({ params }: PageProps<"/journal/[id]">) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const supabase = await createClient();
  const [{ data: trade, error }, tags, data, media] = await Promise.all([
    supabase.from("trades").select("*").eq("id", id).maybeSingle(),
    supabase.from("trade_tags").select("tag_id").eq("trade_id", id),
    loadEditorData(),
    loadMedia("trade", [id]),
  ]);
  if (error) throw error;
  if (tags.error) throw tags.error;

  if (!trade) {
    // Not saved yet (e.g. a draft that never reached the server) → continue as new.
    return <TradeEditorClient key={id} data={data} mode="new" restoreId={id} />;
  }

  if (trade.deleted_at) {
    return (
      <EmptyState
        icon={Trash2}
        title="This trade is in the trash"
        description="Restore it from the trash to edit it again."
      >
        <Button asChild variant="outline">
          <Link href="/journal/trash">Open trash</Link>
        </Button>
      </EmptyState>
    );
  }

  const inst = data.instruments.find((i) => i.id === trade.instrument_id);
  if (!inst) notFound();

  const values = tradeRowToForm(
    {
      ...trade,
      entry_price: Number(trade.entry_price),
      exit_price: trade.exit_price === null ? null : Number(trade.exit_price),
      contracts: trade.contracts === null ? null : Number(trade.contracts),
      stop_price: trade.stop_price === null ? null : Number(trade.stop_price),
      target_price: trade.target_price === null ? null : Number(trade.target_price),
      planned_r: trade.planned_r === null ? null : Number(trade.planned_r),
      fees: trade.fees === null ? null : Number(trade.fees),
      mae_ticks: trade.mae_ticks === null ? null : Number(trade.mae_ticks),
      mfe_ticks: trade.mfe_ticks === null ? null : Number(trade.mfe_ticks),
    },
    inst,
    (tags.data ?? []).map((t) => t.tag_id),
  );

  return (
    <TradeEditorClient
      key={id}
      data={data}
      mode="edit"
      initial={{ values, updatedAt: trade.updated_at, media: media[id] ?? [] }}
    />
  );
}
