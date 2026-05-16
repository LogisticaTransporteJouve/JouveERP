import { describe, expect, it } from "vitest";

import {
  buildAccountTree,
  compareCodes,
  ChartAccountCreateSchema,
  levelFromCode,
  parentCodeFromCode,
  suggestChildCode,
  type ChartAccount,
} from "./schema";

describe("levelFromCode", () => {
  it("counts dot-separated segments", () => {
    expect(levelFromCode("1")).toBe(1);
    expect(levelFromCode("1.1")).toBe(2);
    expect(levelFromCode("1.1.2.3")).toBe(4);
  });
});

describe("parentCodeFromCode", () => {
  it("returns null for root codes", () => {
    expect(parentCodeFromCode("1")).toBeNull();
    expect(parentCodeFromCode("99")).toBeNull();
  });
  it("drops the last segment", () => {
    expect(parentCodeFromCode("1.1")).toBe("1");
    expect(parentCodeFromCode("1.1.2.3")).toBe("1.1.2");
  });
});

describe("suggestChildCode", () => {
  it("starts at 1 when no siblings exist", () => {
    expect(suggestChildCode("1", [])).toBe("1.1");
    expect(suggestChildCode("1.1", [])).toBe("1.1.1");
  });
  it("picks max(sibling segment) + 1", () => {
    expect(suggestChildCode("1.1", ["1.1.1", "1.1.2", "1.1.5"])).toBe("1.1.6");
  });
  it("ignores grandchildren when picking the next sibling code", () => {
    expect(
      suggestChildCode("1.1", ["1.1.1", "1.1.1.1", "1.1.2", "1.1.2.7"]),
    ).toBe("1.1.3");
  });
});

describe("compareCodes", () => {
  it("orders numerically per segment, not lexicographically", () => {
    expect(compareCodes("1.2", "1.10")).toBeLessThan(0);
    expect(compareCodes("1.10", "1.2")).toBeGreaterThan(0);
  });
  it("treats shorter codes as parents", () => {
    expect(compareCodes("1.1", "1.1.1")).toBeLessThan(0);
  });
});

describe("buildAccountTree", () => {
  const mk = (id: string, code: string, parent_id: string | null): ChartAccount =>
    ({
      id,
      parent_id,
      code,
      name: `Cuenta ${code}`,
      level: code.split(".").length,
      account_type: "activo",
      eerr_category: null,
      system_role: null,
      is_active: true,
      created_by: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    }) as ChartAccount;

  it("groups children under parents and sorts by code", () => {
    const rows: ChartAccount[] = [
      mk("a", "1", null),
      mk("c", "1.10", "a"),
      mk("b", "1.2", "a"),
      mk("d", "2", null),
    ];
    const tree = buildAccountTree(rows);
    expect(tree.map((n) => n.code)).toEqual(["1", "2"]);
    const cap1 = tree.find((n) => n.code === "1");
    expect(cap1?.children.map((n) => n.code)).toEqual(["1.2", "1.10"]);
  });

  it("treats orphaned children (missing parent) as roots", () => {
    const rows: ChartAccount[] = [mk("x", "9.9", "missing")];
    const tree = buildAccountTree(rows);
    expect(tree).toHaveLength(1);
    expect(tree[0]!.code).toBe("9.9");
  });
});

describe("ChartAccountCreateSchema", () => {
  it("accepts a valid root account", () => {
    const result = ChartAccountCreateSchema.safeParse({
      parent_id: null,
      code: "1",
      name: "Activo",
      account_type: "activo",
      is_active: true,
    });
    expect(result.success).toBe(true);
  });

  it("rejects malformed code", () => {
    const result = ChartAccountCreateSchema.safeParse({
      parent_id: null,
      code: "1.a",
      name: "Bad",
      account_type: "activo",
      is_active: true,
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown account_type", () => {
    const result = ChartAccountCreateSchema.safeParse({
      parent_id: null,
      code: "1",
      name: "X",
      account_type: "garbage",
      is_active: true,
    });
    expect(result.success).toBe(false);
  });
});
