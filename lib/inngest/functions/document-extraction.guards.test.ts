import { InngestTestEngine } from "@inngest/test";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DOCUMENT_EXTRACTION_REQUESTED } from "@/lib/inngest/events";

// A paid scan is not thrown away for an advisory expense suggestion, and a
// draft that is gone pays for no vision call.

const h = vi.hoisted(() => ({
  awaitsPipeline: vi.fn(),
  downloadFileBytes: vi.fn(),
  classifyDocument: vi.fn(),
  saveExtractionResult: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/users", () => ({ loadUserAccess: async () => null }));
vi.mock("@/features/ai/lib/chat-store", () => ({
  recordAiUsage: vi.fn(async () => {}),
}));
vi.mock("@/features/ai/document/engine", () => ({
  classifyDocument: (...args: unknown[]) => h.classifyDocument(...args),
  extractDocument: vi.fn(),
}));
vi.mock("@/features/ai/document/store", () => ({
  downloadFileBytes: (...args: unknown[]) => h.downloadFileBytes(...args),
  extractionAwaitsPipeline: (...args: unknown[]) => h.awaitsPipeline(...args),
  extractionRequester: vi.fn(),
  markExtractionFailed: vi.fn(),
  matchForKind: vi.fn(),
  saveExtractionResult: (...args: unknown[]) => h.saveExtractionResult(...args),
  unverifiedMatches: vi.fn(),
}));
// The expense catalog read fails on every attempt.
vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => ({
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve({
            data: null,
            error: { message: "statement timeout" },
          }).then(resolve),
      };
      return chain;
    },
  }),
}));

const { documentExtraction } = await import("./document-extraction");

const EXTRACTION = "6a1c2b3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const EVENT = {
  name: DOCUMENT_EXTRACTION_REQUESTED,
  data: {
    extraction_id: EXTRACTION,
    file_id: "3f0c9a9e-5a51-4c55-9b0e-0b7d1c1c2a10",
  },
};

beforeEach(() => vi.clearAllMocks());

describe("documentExtraction classify-expense step", () => {
  function run(attempt: number) {
    return new InngestTestEngine({
      function: documentExtraction,
      events: [EVENT],
      steps: [
        { id: "requester", handler: () => null },
        {
          id: "classify-and-extract",
          handler: () => ({
            kind: "purchase_invoice",
            confidence: 1,
            payload: { net_amount: 100 },
          }),
        },
        { id: "match", handler: () => ({ supplier_id: null }) },
      ],
      transformCtx: (ctx) => ({ ...ctx, attempt, maxAttempts: 3 }),
    }).execute();
  }

  it("rethrows a failed catalog read before the last attempt", async () => {
    const { error } = await run(1);
    expect(error).toBeTruthy();
    expect(h.saveExtractionResult).not.toHaveBeenCalled();
  });

  it("on the last attempt saves the paid scan without a suggestion", async () => {
    const { error } = await run(2);
    expect(error).toBeFalsy();
    expect(h.saveExtractionResult).toHaveBeenCalledWith(
      EXTRACTION,
      expect.objectContaining({
        status: "pending_review",
        detectedType: "purchase_invoice",
        matches: { supplier_id: null },
      }),
    );
  });
});

describe("documentExtraction on a draft that is gone", () => {
  it("makes no vision call and saves nothing", async () => {
    h.awaitsPipeline.mockResolvedValue(false);
    const { error, result } = await new InngestTestEngine({
      function: documentExtraction,
      events: [EVENT],
      steps: [{ id: "requester", handler: () => null }],
    }).execute();
    expect(error).toBeFalsy();
    expect(result).toEqual({ extraction_id: EXTRACTION, kind: null });
    expect(h.awaitsPipeline).toHaveBeenCalledWith(EXTRACTION);
    expect(h.downloadFileBytes).not.toHaveBeenCalled();
    expect(h.classifyDocument).not.toHaveBeenCalled();
    expect(h.saveExtractionResult).not.toHaveBeenCalled();
  });

  it("still reads a live draft", async () => {
    h.awaitsPipeline.mockResolvedValue(true);
    h.downloadFileBytes.mockRejectedValue(new Error("stop here"));
    await new InngestTestEngine({
      function: documentExtraction,
      events: [EVENT],
      steps: [{ id: "requester", handler: () => null }],
    }).execute();
    expect(h.downloadFileBytes).toHaveBeenCalled();
  });
});
