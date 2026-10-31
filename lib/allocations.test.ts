import { describe, expect, it } from "vitest";

import {
  allocateFifo,
  allocationsIssue,
  readEmbeddedStatus,
  sumAllocations,
} from "./allocations";

describe("sumAllocations", () => {
  it("sums per document (counted only) and per payer (all), plus openings", () => {
    const { appliedByDocument, appliedByPayer } = sumAllocations(
      [
        {
          document_id: "inv1",
          payer_id: "r1",
          amount_applied: "100.50",
          counts_for_document: true,
        },
        {
          document_id: "inv1",
          payer_id: "r2",
          amount_applied: 50,
          counts_for_document: true,
        },
        // canceled payer: excluded from the document, still part of its own total
        {
          document_id: "inv2",
          payer_id: "r3",
          amount_applied: 70,
          counts_for_document: false,
        },
        {
          document_id: null,
          payer_id: "r1",
          amount_applied: 10,
          counts_for_document: true,
        },
      ],
      [
        { document_id: "inv2", amount_applied: "30" },
        { document_id: "inv3", amount_applied: 5 },
      ],
    );
    expect(Object.fromEntries(appliedByDocument)).toEqual({
      inv1: 150.5,
      inv2: 30,
      inv3: 5,
    });
    expect(Object.fromEntries(appliedByPayer)).toEqual({
      r1: 110.5,
      r2: 50,
      r3: 70,
    });
  });

  it("returns empty maps for no input", () => {
    const t = sumAllocations([], []);
    expect(t.appliedByDocument.size).toBe(0);
    expect(t.appliedByPayer.size).toBe(0);
  });
});

describe("readEmbeddedStatus", () => {
  it("reads object and array embeds", () => {
    expect(readEmbeddedStatus({ status: "issued" })).toBe("issued");
    expect(readEmbeddedStatus([{ status: "canceled" }])).toBe("canceled");
  });

  it("returns null for missing / malformed embeds", () => {
    expect(readEmbeddedStatus(null)).toBeNull();
    expect(readEmbeddedStatus([])).toBeNull();
    expect(readEmbeddedStatus({ status: 3 })).toBeNull();
    expect(readEmbeddedStatus({})).toBeNull();
  });
});

describe("allocateFifo", () => {
  const pending = [
    { id: "b", fecha: "2026-09-01", outstanding: 100 },
    { id: "a", fecha: "2026-09-01", outstanding: 50.55 },
    { id: "c", fecha: "2026-08-01", outstanding: 30 },
  ];

  it("fills oldest first (ties by id) and stops when the amount runs out", () => {
    expect(allocateFifo(pending, 100)).toEqual([
      { document_id: "c", amount_applied: 30 },
      { document_id: "a", amount_applied: 50.55 },
      { document_id: "b", amount_applied: 19.45 },
    ]);
  });

  it("allocates nothing for a zero amount or an empty list", () => {
    expect(allocateFifo(pending, 0)).toEqual([]);
    expect(allocateFifo([], 500)).toEqual([]);
  });
});

describe("allocationsIssue", () => {
  const pending = [{ id: "a", fecha: "2026-09-01", outstanding: 100 }];

  it("accepts allocations within the outstanding and the total", () => {
    expect(
      allocationsIssue(
        pending,
        [{ document_id: "a", amount_applied: 100 }],
        100,
      ),
    ).toBeNull();
  });

  it("rejects a document that is not pending", () => {
    expect(
      allocationsIssue(pending, [{ document_id: "x", amount_applied: 1 }], 100),
    ).toMatch(/ya no tiene saldo/);
  });

  it("rejects two lines that together exceed one document's outstanding", () => {
    expect(
      allocationsIssue(
        pending,
        [
          { document_id: "a", amount_applied: 60 },
          { document_id: "a", amount_applied: 60 },
        ],
        200,
      ),
    ).toMatch(/excede el saldo pendiente/);
  });

  it("rejects allocations over the payer's total", () => {
    expect(
      allocationsIssue(
        pending,
        [{ document_id: "a", amount_applied: 100 }],
        90,
      ),
    ).toMatch(/superan el total/);
  });
});
