import type { Metadata } from "next";

import { APP_NAME, APP_TAGLINE } from "@/lib/app";
import { safeNextPath } from "@/lib/safe-redirect";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const next = safeNextPath(typeof params.next === "string" ? params.next : null);
  const linkError = params.error === "link";

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">{APP_NAME}</h1>
          <p className="text-muted-foreground text-sm">{APP_TAGLINE}</p>
        </div>
        <LoginForm next={next} linkError={linkError} />
      </div>
    </main>
  );
}
