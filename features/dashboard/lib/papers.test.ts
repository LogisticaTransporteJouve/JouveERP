import { describe, expect, it } from "vitest";

import { pendingPapers, type PaperDoc } from "./papers";

const TODAY = "2026-11-02";

function doc(overrides: Partial<PaperDoc>): PaperDoc {
  return {
    id: "d1",
    kind: "vtv",
    kindLabel: "VTV",
    expires_at: "2026-11-10",
    holderKind: "vehicle",
    holderId: "v1",
    holderName: "AB123CD",
    holderActive: true,
    href: "/fleet-documents",
    ...overrides,
  };
}

describe("pendingPapers", () => {
  it("keeps expired and soon-expiring papers, expired first", () => {
    const res = pendingPapers(
      [
        doc({ id: "soon", expires_at: "2026-11-20" }),
        doc({
          id: "late",
          holderKind: "employee",
          holderId: "e1",
          expires_at: "2026-10-01",
        }),
        doc({ id: "far", holderId: "v2", expires_at: "2027-03-01" }),
      ],
      TODAY,
    );
    expect(res.map((p) => [p.id, p.expired])).toEqual([
      ["late", true],
      ["soon", false],
    ]);
  });

  it("counts a renewed paper as done: the holder's latest of a kind decides", () => {
    const res = pendingPapers(
      [
        doc({ id: "old", expires_at: "2026-10-01" }),
        doc({ id: "renewed", expires_at: "2027-10-01" }),
        doc({ id: "other-kind", kind: "seguro", expires_at: "2026-10-15" }),
      ],
      TODAY,
    );
    expect(res.map((p) => p.id)).toEqual(["other-kind"]);
  });

  it("drops inactive holders and documents with no holder", () => {
    const res = pendingPapers(
      [
        doc({ id: "inactive", holderActive: false }),
        doc({ id: "orphan", holderId: null }),
      ],
      TODAY,
    );
    expect(res).toEqual([]);
  });

  it("includes a paper due on the horizon's last day", () => {
    expect(
      pendingPapers([doc({ expires_at: "2026-12-02" })], TODAY),
    ).toHaveLength(1);
    expect(
      pendingPapers([doc({ expires_at: "2026-12-03" })], TODAY),
    ).toHaveLength(0);
  });
});
