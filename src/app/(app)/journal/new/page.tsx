import type { Metadata } from "next";

import { TradeEditorClient } from "@/components/trade/editor-client";
import { loadEditorData } from "@/lib/data/editor";

export const metadata: Metadata = { title: "Log trade" };

export default async function NewTradePage({ searchParams }: PageProps<"/journal/new">) {
  const params = await searchParams;
  const one = (k: string) => (typeof params[k] === "string" ? (params[k] as string) : undefined);
  const restoreId = one("restore");
  const direction = one("direction");
  const data = await loadEditorData();
  return (
    <TradeEditorClient
      key={restoreId ?? "new"}
      data={data}
      mode="new"
      restoreId={restoreId}
      preset={{
        playbookId: one("playbook"),
        instrumentId: one("instrument"),
        direction: direction === "long" || direction === "short" ? direction : undefined,
      }}
    />
  );
}
