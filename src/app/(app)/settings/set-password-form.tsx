"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";

const MIN_LENGTH = 10;

export function SetPasswordForm() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_LENGTH) {
      setError(`Use at least ${MIN_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    const { error: updateError } = await createClient().auth.updateUser({ password });
    setBusy(false);
    if (updateError) {
      setError("Could not update the password. Retry.");
      return;
    }
    setPassword("");
    setConfirm("");
    toast.success("Password saved");
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3" aria-labelledby="set-password-heading">
      <p id="set-password-heading" className="text-sm font-medium">
        Set a password <span className="text-muted-foreground font-normal">(optional)</span>
      </p>
      <div className="space-y-2">
        <Label htmlFor="new-password">New password</Label>
        <Input
          id="new-password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirm-password">Confirm password</Label>
        <Input
          id="confirm-password"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </div>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <Button type="submit" disabled={busy || !password}>
        {busy && <Loader2 className="animate-spin" aria-hidden />}
        Save password
      </Button>
    </form>
  );
}
