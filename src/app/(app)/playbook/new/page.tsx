import type { Metadata } from "next";
import { randomUUID } from "node:crypto";

import { PlaybookEditorClient } from "@/components/playbook/playbook-editor-client";
import { PageHeader } from "@/components/shell/empty-state";
import { loadActiveSymbols } from "@/lib/data/instruments";
import { DOMAIN_CODES, type DomainCode } from "@/lib/domains";
import { emptyPlaybook } from "@/lib/playbook/form";

export const metadata: Metadata = { title: "New playbook" };

function newId() {
  return randomUUID();
}

export default async function NewPlaybookPage({ searchParams }: PageProps<"/playbook/new">) {
  const sp = await searchParams;
  const domain = (DOMAIN_CODES as readonly string[]).includes(String(sp.domain))
    ? (sp.domain as DomainCode)
    : "TECHNICAL";
  const symbols = await loadActiveSymbols();
  const id = newId();
  return (
    <>
      <PageHeader title="New playbook" />
      <PlaybookEditorClient
        key={id}
        initial={emptyPlaybook(id, domain)}
        isNew
        version={1}
        updatedAt={null}
        symbols={symbols}
      />
    </>
  );
}
