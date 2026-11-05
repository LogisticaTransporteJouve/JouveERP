import { InngestTestEngine } from "@inngest/test";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";
import { DOCUMENT_EXTRACTION_REQUESTED } from "@/lib/inngest/events";

const h = vi.hoisted(() => ({
  matchForKind: vi.fn(),
  saveExtractionResult: vi.fn(),
}));

vi.mock("@/lib/auth/users", () => ({
  loadUserAccess: async () => resolveAccess(["finance"]),
}));
vi.mock("@/features/ai/document/store", async (importOriginal) => {
  const real =
    await importOriginal<typeof import("@/features/ai/document/store")>();
  return {
    downloadFileBytes: vi.fn(),
    extractionRequester: vi.fn(),
    markExtractionFailed: vi.fn(),
    matchForKind: (...args: unknown[]) => h.matchForKind(...args),
    saveExtractionResult: (...args: unknown[]) =>
      h.saveExtractionResult(...args),
    unverifiedMatches: real.unverifiedMatches,
  };
});
vi.mock("server-only", () => ({}));

const { documentExtraction } = await import("./document-extraction");

const EXTRACTION = "6a1c2b3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

/** One execution with the `match` step on attempt `attempt` of 3. */
function run(attempt: number) {
  return new InngestTestEngine({
    function: documentExtraction,
    events: [
      {
        name: DOCUMENT_EXTRACTION_REQUESTED,
        data: {
          extraction_id: EXTRACTION,
          file_id: "3f0c9a9e-5a51-4c55-9b0e-0b7d1c1c2a10",
        },
      },
    ],
    steps: [
      {
        id: "requester",
        handler: () => "8b5d3c7e-1f2a-4b3c-9d4e-5f6a7b8c9d0e",
      },
      {
        id: "classify-and-extract",
        handler: () => ({
          kind: "sales_invoice",
          confidence: 1,
          payload: { counterparty_cuit: "30712345678" },
        }),
      },
    ],
    transformCtx: (ctx) => ({ ...ctx, attempt, maxAttempts: 3 }),
  }).execute();
}

beforeEach(() => {
  vi.clearAllMocks();
  h.matchForKind.mockRejectedValue(new Error("statement timeout"));
});

describe("documentExtraction match step (audit w14-s5 F2)", () => {
  it("rethrows a failed lookup before the last attempt, so the step retries", async () => {
    const { error } = await run(1);
    expect(error).toBeTruthy();
    expect(h.saveExtractionResult).not.toHaveBeenCalled();
  });

  it("on the last attempt saves the paid extraction marked «no se pudo verificar»", async () => {
    const { error } = await run(2);
    expect(error).toBeFalsy();
    expect(h.saveExtractionResult).toHaveBeenCalledWith(
      EXTRACTION,
      expect.objectContaining({
        status: "pending_review",
        payload: { counterparty_cuit: "30712345678" },
        matches: {
          lookup_failed: true,
          counterparty_unchecked: true,
          duplicate_unknown: true,
        },
      }),
    );
  });
});
