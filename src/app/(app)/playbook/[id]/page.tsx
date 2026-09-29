import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Trash2 } from "lucide-react";

import { PlaybookExamples } from "@/components/playbook/examples";
import { PlaybookEditorClient } from "@/components/playbook/playbook-editor-client";
import { PlaybookStatsView } from "@/components/playbook/playbook-stats";
import { RestorePlaybookButton } from "@/components/playbook/restore-button";
import { VersionHistory } from "@/components/playbook/version-history";
import { EmptyState } from "@/components/shell/empty-state";
import { BrokerVerification } from "@/components/statements/broker-card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { loadActiveSymbols } from "@/lib/data/instruments";
import { loadPlaybookPage } from "@/lib/data/playbook";

export const metadata: Metadata = { title: "Playbook" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PlaybookDetailPage({ params }: PageProps<"/playbook/[id]">) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const [data, symbols] = await Promise.all([loadPlaybookPage(id), loadActiveSymbols()]);
  if (!data) notFound();

  if (data.deleted) {
    return (
      <EmptyState
        icon={Trash2}
        title="This playbook was deleted"
        description="Restore it to edit it and see its stats again."
      >
        <RestorePlaybookButton id={id} name={data.snapshot.name} />
      </EmptyState>
    );
  }

  const taken = data.trades.filter((t) => t.kind === "taken").length;

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link href="/playbook">
          <ChevronLeft aria-hidden />
          Playbooks
        </Link>
      </Button>
      <Tabs defaultValue="playbook">
        <TabsList>
          <TabsTrigger value="playbook">Playbook</TabsTrigger>
          <TabsTrigger value="stats">Stats ({taken})</TabsTrigger>
          <TabsTrigger value="history">History (v{data.version})</TabsTrigger>
          <TabsTrigger value="examples">Examples</TabsTrigger>
        </TabsList>
        <TabsContent value="playbook" className="pt-4">
          <PlaybookEditorClient
            key={id}
            initial={data.snapshot}
            isNew={false}
            version={data.version}
            updatedAt={data.updatedAt}
            symbols={symbols}
          />
        </TabsContent>
        <TabsContent value="stats" className="space-y-4 pt-4">
          <BrokerVerification trades={data.trades} />
          <PlaybookStatsView trades={data.trades} />
        </TabsContent>
        <TabsContent value="history" className="pt-4">
          <VersionHistory versions={data.versions} trades={data.trades} />
        </TabsContent>
        <TabsContent value="examples" className="pt-4">
          <PlaybookExamples playbookId={id} examples={data.examples} pinned={data.pinned} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
