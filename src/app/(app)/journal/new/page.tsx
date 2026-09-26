import type { Metadata } from "next";

import { TradeEditorClient } from "@/components/trade/editor-client";
import { loadEditorData } from "@/lib/data/editor";

export const metadata: Metadata = { title: "Log trade" };

export default async function NewTradePage({ searchParams }: PageProps<"/journal/new">) {
  const params = await searchParams;
  const restoreId = typeof params.restore === "string" ? params.restore : undefined;
  const data = await loadEditorData();
  return (
    <TradeEditorClient key={restoreId ?? "new"} data={data} mode="new" restoreId={restoreId} />
  );
}
