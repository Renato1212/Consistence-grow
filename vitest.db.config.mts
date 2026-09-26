import { defineConfig } from "vitest/config";

/**
 * Database / RLS tests. They run against the LOCAL Supabase stack only
 * (`pnpm db:start`), never against production.
 */
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["tests/db/**/*.test.ts"],
    testTimeout: 20_000,
    fileParallelism: false,
  },
});
