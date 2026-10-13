import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["**/*.test.ts", "**/*.test.tsx"],
    exclude: ["node_modules", ".next", "out", "build", ".claude"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      // server-only throws when imported outside of a Server Component build.
      // In tests we exercise the modules directly, so alias it to a no-op.
      "server-only": path.resolve(__dirname, "tests/stubs/server-only.ts"),
    },
  },
});
