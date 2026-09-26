"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MailCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { createClient } from "@/lib/supabase/client";

type Status =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "sent"; email: string }
  | { kind: "error"; message: string };

// Deliberately generic: never reveal whether an account exists.
const GENERIC_ERROR = "Sign-in failed. Check the email/password and retry.";

export function LoginForm({ next, linkError }: { next: string; linkError: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<Status>(
    linkError
      ? { kind: "error", message: "That sign-in link is invalid or expired. Request a new one." }
      : { kind: "idle" },
  );
  const busy = status.kind === "busy";

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setStatus({ kind: "busy" });
    const supabase = createClient();
    const redirect = new URL("/auth/callback", window.location.origin);
    redirect.searchParams.set("next", next);
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: redirect.toString() },
    });
    if (error) {
      setStatus({
        kind: "error",
        message:
          error.status === 429
            ? "Too many emails requested. Wait a minute and retry."
            : "Could not send the link. Retry in a moment.",
      });
      return;
    }
    setStatus({ kind: "sent", email: email.trim() });
  }

  async function signInWithPassword(e: React.FormEvent) {
    e.preventDefault();
    setStatus({ kind: "busy" });
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) {
      setStatus({ kind: "error", message: GENERIC_ERROR });
      return;
    }
    router.replace(next);
    router.refresh();
  }

  if (status.kind === "sent") {
    return (
      <Card>
        <CardContent className="space-y-2 text-center">
          <MailCheck className="text-primary mx-auto size-8" aria-hidden />
          <p className="font-medium">Check your inbox</p>
          <p className="text-muted-foreground text-sm">
            A sign-in link is on its way to <span className="text-foreground">{status.email}</span>.
          </p>
          <Button variant="link" onClick={() => setStatus({ kind: "idle" })}>
            Use a different method
          </Button>
        </CardContent>
      </Card>
    );
  }

  const emailField = (
    <div className="space-y-2">
      <Label htmlFor="email">Email</Label>
      <Input
        id="email"
        type="email"
        autoComplete="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
    </div>
  );

  return (
    <Card>
      <CardContent>
        <Tabs defaultValue="magic">
          <TabsList className="w-full">
            <TabsTrigger value="magic">Magic link</TabsTrigger>
            <TabsTrigger value="password">Password</TabsTrigger>
          </TabsList>

          <TabsContent value="magic">
            <form onSubmit={sendMagicLink} className="space-y-4 pt-2">
              {emailField}
              <Button type="submit" className="w-full" disabled={busy}>
                {busy && <Loader2 className="animate-spin" aria-hidden />}
                Email me a sign-in link
              </Button>
            </form>
          </TabsContent>

          <TabsContent value="password">
            <form onSubmit={signInWithPassword} className="space-y-4 pt-2">
              {emailField}
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <Button type="submit" className="w-full" disabled={busy}>
                {busy && <Loader2 className="animate-spin" aria-hidden />}
                Sign in
              </Button>
            </form>
          </TabsContent>
        </Tabs>

        {status.kind === "error" && (
          <p role="alert" className="text-destructive mt-4 text-sm">
            {status.message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
