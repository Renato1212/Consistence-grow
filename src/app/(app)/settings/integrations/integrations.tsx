"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Copy, KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Field } from "@/components/form/field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { AI_SCHEDULE, AI_SCHEDULE_TEXT } from "@/lib/ai/schedule";
import { generateToken, hashToken, tokenPrefix } from "@/lib/briefs/token";
import { logClientError } from "@/lib/client-errors";
import type { ApiToken, Brief } from "@/lib/data/briefs";
import { createClient } from "@/lib/supabase/client";
import { DISPLAY_TZ, formatInTz } from "@/lib/time";

export function Integrations({
  tokens,
  briefs,
}: {
  tokens: ApiToken[];
  briefs: Omit<Brief, "markdown">[];
}) {
  const router = useRouter();
  const [scope, setScope] = useState<"briefs" | "ai" | "statements">("briefs");
  const [name, setName] = useState("Macro Desk routine");
  const [created, setCreated] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const origin = useSyncExternalStore(
    () => () => {},
    () => window.location.origin,
    () => "",
  );
  const endpoint = `${origin}/api/ingest/brief`;
  const aiBase = `${origin}/api/ai`;

  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    const token = generateToken();
    const { error } = await createClient()
      .from("api_tokens")
      .insert({
        name: name.trim(),
        token_hash: await hashToken(token),
        prefix: tokenPrefix(token),
        scopes: [scope],
      });
    setBusy(false);
    if (error) {
      logClientError("tokens.create", error);
      toast.error("Token not created — retry.");
      return;
    }
    setCreated(token);
    router.refresh();
  }

  async function revoke(t: ApiToken) {
    if (!window.confirm(`Revoke "${t.name}"? Anything using it stops working immediately.`)) return;
    const { error } = await createClient()
      .from("api_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", t.id);
    if (error) {
      logClientError("tokens.revoke", error, { id: t.id });
      toast.error("Not revoked — retry.");
      return;
    }
    toast.success("Token revoked");
    router.refresh();
  }

  const copy = (text: string) =>
    navigator.clipboard.writeText(text).then(
      () => toast.success("Copied"),
      () => toast.error("Copy failed — select and copy manually"),
    );

  return (
    <div className="grid max-w-3xl grid-cols-[minmax(0,1fr)] gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Macro Desk brief</CardTitle>
          <CardDescription>
            Your daily Pre-Session Brief lands in the matching prep (European-open → EU prep,
            US-session refresh → US prep) and its TL;DR shows on Today. An empty Brief section is
            filled automatically; if you already wrote one, the prep offers to replace it.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground text-xs">Send with a token from below:</p>
          <pre
            className="bg-muted overflow-x-auto rounded-md p-3 text-xs"
            data-testid="ingest-example"
            tabIndex={0}
            aria-label="Brief delivery request example"
          >
            {`POST ${endpoint}
Authorization: Bearer <token>
Content-Type: application/json

{ "edition": "eu" | "us", "markdown": "…", "date": "YYYY-MM-DD" (optional, default today in Lisbon) }`}
          </pre>
          <p className="text-muted-foreground text-xs">
            Sending the same date and edition again replaces that brief.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>AI analysis (Claude subscription)</CardTitle>
          <CardDescription>
            Claude analyses your Insights on your Claude plan — no API credits. A scheduled Claude
            Code routine picks up queued analyses, reads the same numbers you see (with n and
            confidence intervals) and posts findings back. {AI_SCHEDULE_TEXT}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <ul className="text-muted-foreground list-disc space-y-1 pl-5 text-xs">
            {AI_SCHEDULE.map((s) => (
              <li key={s.slot}>
                {s.days} {s.time} Lisbon — {s.label}
              </li>
            ))}
          </ul>
          <pre
            className="bg-muted overflow-x-auto rounded-md p-3 text-xs"
            data-testid="ai-example"
            tabIndex={0}
            aria-label="AI routine request example"
          >
            {`GET  ${aiBase}/queue?slot=eu|us|weekly
POST ${aiBase}/findings   { "request_id", "data_hash", "model", "output" }
Authorization: Bearer <token with the AI analysis scope>`}
          </pre>
          <p className="text-muted-foreground text-xs">
            Store the token as the routine&apos;s <code>CG_AI_TOKEN</code> secret, next to{" "}
            <code>CG_APP_URL</code>. It can only read the analysis queue and post findings.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>API tokens</CardTitle>
          <CardDescription>
            Each token has one purpose: delivering briefs, or the AI analysis queue. It is shown
            once — store it as a secret where the job runs. Only a hash is kept here.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {created && (
            <div role="status" className="border-primary/60 space-y-2 rounded-md border p-3">
              <p className="text-sm font-semibold">
                Copy this token now — it will not be shown again.
              </p>
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={created}
                  className="num text-xs"
                  data-testid="new-token"
                  aria-label="New token"
                />
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Copy token"
                  onClick={() => copy(created)}
                >
                  <Copy aria-hidden />
                </Button>
              </div>
            </div>
          )}
          <Segmented
            label="Token purpose"
            size="sm"
            value={scope}
            onChange={(v) => {
              setScope(v);
              setName(
                v === "ai"
                  ? "AI analysis routine"
                  : v === "statements"
                    ? "Statement delivery"
                    : "Macro Desk routine",
              );
            }}
            options={[
              { value: "briefs", label: "Macro Desk briefs" },
              { value: "ai", label: "AI analysis" },
              { value: "statements", label: "Statements" },
            ]}
          />
          <div className="flex flex-wrap items-end gap-2">
            <Field id="token-name" label="Name">
              <Input
                id="token-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-64"
              />
            </Field>
            <Button onClick={create} disabled={busy || !name.trim()}>
              {busy ? <Loader2 className="animate-spin" aria-hidden /> : <KeyRound aria-hidden />}
              Create token
            </Button>
          </div>
          {tokens.length === 0 ? (
            <p className="text-muted-foreground text-sm">No active tokens.</p>
          ) : (
            <ul className="divide-y rounded-lg border" data-testid="token-list">
              {tokens.map((t) => (
                <li key={t.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="flex-1">
                    {t.name} <span className="num text-muted-foreground text-xs">{t.prefix}</span>{" "}
                    <Badge variant="outline" data-testid="token-scope">
                      {t.scopes.includes("ai")
                        ? "AI analysis"
                        : t.scopes.includes("statements")
                          ? "Statements"
                          : "Briefs"}
                    </Badge>
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {t.lastUsedAt
                      ? `Used ${formatInTz(t.lastUsedAt, DISPLAY_TZ, "d MMM HH:mm")}`
                      : "Never used"}
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => revoke(t)}>
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent briefs</CardTitle>
        </CardHeader>
        <CardContent>
          {briefs.length === 0 ? (
            <p className="text-muted-foreground text-sm">No briefs received yet.</p>
          ) : (
            <ul className="divide-y rounded-lg border" data-testid="recent-briefs">
              {briefs.map((b) => (
                <li key={b.id}>
                  <Link
                    href={`/prep/${b.date}/${b.session.toLowerCase()}`}
                    className="hover:bg-muted/50 flex items-center gap-3 px-3 py-2 text-sm"
                  >
                    <span className="num w-24">{b.date}</span>
                    <span className="w-10 font-semibold">{b.session}</span>
                    <span className="text-muted-foreground flex-1 text-xs">{b.source}</span>
                    <span className="text-muted-foreground text-xs">
                      received {formatInTz(b.receivedAt, DISPLAY_TZ, "d MMM HH:mm")}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
