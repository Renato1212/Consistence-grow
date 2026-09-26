# Decisions log

Format: date — decision — reason.

## Phase 0 — Setup

- 2026-09-26 — Fresh repo `renato1212/consistence-grow`; the older "Infinite Grow" project is not reused. — User asked to build from scratch.
- 2026-09-26 — App name **Consistent Grow**. — User choice.
- 2026-09-26 — New Supabase project `consistent-grow` in eu-west-3 (Paris) on the **Free** plan. — User choice; closest region to Lisbon. Consequence: 50 MB max per uploaded file; larger videos must be added as links (YouTube unlisted / Drive). Free projects pause after ~7 days without activity; daily use prevents it.
- 2026-09-26 — Latest stable majors: Next 16.3, React 19.2, Tailwind 4, zod 4, Vitest 5, TypeScript 5.9. — Spec asks for latest stable.
- 2026-09-26 — shadcn/ui components are hand-written in `src/components/ui` (same Radix + cva code the CLI generates). — `ui.shadcn.com` is blocked by the cloud sandbox egress policy, so the CLI cannot fetch the registry.
- 2026-09-26 — Supabase **publishable key** (`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`) instead of the legacy anon JWT. — Current Supabase recommendation; rotatable independently of the JWT secret.
- 2026-09-26 — Single-user lock = `private.allowed_signups` table + `before insert` trigger on `auth.users`. The production email is inserted by hand, not committed. — Works regardless of the dashboard sign-up toggle and cannot be bypassed by the API; keeps personal data out of git.
- 2026-09-26 — Auth: magic link (PKCE via `/auth/callback`) + optional password set in Settings → Account. — Spec §4; password gives a fallback when email is slow.
- 2026-09-26 — Static CSP in `next.config.ts` (with `'unsafe-inline'` scripts) rather than per-request nonces. — Nonces force every page to render dynamically and add a failure mode; the app has no third-party scripts, so the practical risk is low. Revisit if third-party scripts are ever added.
- 2026-09-26 — Route handlers redirect with a relative `Location` header. — Absolute URLs built from the request host (localhost vs 127.0.0.1 / proxies) were blocked by CSP `form-action` in testing.
- 2026-09-26 — CI and all DB/E2E tests run against a **local Supabase stack in Docker** (`supabase start`), never the production project. Test helpers refuse non-local URLs. — Reliability and safety of real data.
- 2026-09-26 — Vercel functions region `cdg1` (Paris). — Same city as Supabase eu-west-3: lowest DB latency.
- 2026-09-26 — Phase-0 shortcuts: `⌘K`, `G then T/J/R/I/P/S`, `N`. `P`, `D` and `/` are wired in the phases that ship prep, debrief and search. — Never ship a shortcut that leads nowhere.
- 2026-09-26 — Header shows Lisbon + New York clocks; the London/NY choice becomes a setting in Phase 1. — Keep Phase 0 minimal.
