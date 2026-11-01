import { describe, expect, it } from "vitest";

import { buildContentSecurityPolicy } from "./csp";

describe("buildContentSecurityPolicy", () => {
  it("lets same-origin workers run despite 'strict-dynamic' in script-src", () => {
    const csp = buildContentSecurityPolicy({
      nonce: "n",
      isDev: false,
      supabaseUrl: "https://x.supabase.co",
    });
    expect(csp).toContain("script-src 'self' 'nonce-n' 'strict-dynamic'");
    expect(csp).toContain("worker-src 'self' blob:");
  });
});
