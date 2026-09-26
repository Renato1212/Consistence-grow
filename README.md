# Consistent Grow

A calm, fast daily workspace for a discretionary futures day trader: **prepare → log → debrief →
analyse → build playbooks**, organised around the five Axia edge domains and the
Context → Edge → Process pillars.

- Product spec: [`docs/BUILD_SPEC.md`](docs/BUILD_SPEC.md)
- Engineering guide: [`CLAUDE.md`](CLAUDE.md)
- Decisions: [`DECISIONS.md`](DECISIONS.md)

## Local development

```bash
pnpm install
cp .env.example .env.local        # fill NEXT_PUBLIC_SUPABASE_* from `supabase status`
pnpm db:start                     # local Supabase in Docker
pnpm dev                          # http://localhost:3000
```

Checks: `pnpm check` · DB tests: `pnpm test:db` · E2E: `pnpm build && pnpm e2e`.
