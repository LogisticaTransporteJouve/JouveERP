import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/service", () => ({ getServiceClient: vi.fn() }));

const { withoutIgnored } = await import("./analyst");
const { insightFingerprint } = await import("./lib/fingerprint");

const row = (kind: string, refs: string[]) => ({
  kind,
  severity: "warning" as const,
  title: kind,
  finding: "",
  metrics: {},
  source_refs: refs,
});

describe("withoutIgnored", () => {
  it("drops a finding someone ignored and keeps new ones and aggregate cards", () => {
    const ignored = insightFingerprint("dup_invoice", ["a", "b"]);
    const kept = withoutIgnored(
      [
        row("dup_invoice", ["b", "a"]),
        row("dup_invoice", ["c", "d"]),
        row("cashflow", []),
      ],
      new Set(ignored ? [ignored] : []),
    );
    expect(kept.map((r) => [r.kind, r.source_refs])).toEqual([
      ["dup_invoice", ["c", "d"]],
      ["cashflow", []],
    ]);
    expect(kept[1]?.fingerprint).toBeNull();
  });
});
