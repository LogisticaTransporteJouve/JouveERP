import { InngestTestEngine } from "@inngest/test";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess, type Access } from "@/lib/auth/permissions";
import { DOCUMENT_EXTRACTION_REQUESTED } from "@/lib/inngest/events";

let access: Access | null = null;
const h = vi.hoisted(() => ({
  loadUserAccess: vi.fn(),
  matchForKind: vi.fn(),
}));

vi.mock("@/lib/auth/users", () => ({
  loadUserAccess: (...args: unknown[]) => h.loadUserAccess(...args),
}));
vi.mock("@/features/ai/document/store", () => ({
  downloadFileBytes: vi.fn(),
  extractionRequester: vi.fn(),
  markExtractionFailed: vi.fn(),
  matchForKind: (...args: unknown[]) => h.matchForKind(...args),
  saveExtractionResult: vi.fn(),
}));

const { documentExtraction } = await import("./document-extraction");

const USER = "8b5d3c7e-1f2a-4b3c-9d4e-5f6a7b8c9d0e";

function run(requester: string | null) {
  return new InngestTestEngine({
    function: documentExtraction,
    events: [
      {
        name: DOCUMENT_EXTRACTION_REQUESTED,
        data: {
          extraction_id: "6a1c2b3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
          file_id: "3f0c9a9e-5a51-4c55-9b0e-0b7d1c1c2a10",
        },
      },
    ],
    steps: [
      { id: "requester", handler: () => requester },
      {
        id: "classify-and-extract",
        handler: () => ({ kind: "bank_statement", confidence: 1, payload: {} }),
      },
      { id: "save", handler: () => undefined },
    ],
  }).execute();
}

/** The read predicate the job handed to matchForKind. */
function canRead(): (permission: string) => boolean {
  const call = h.matchForKind.mock.calls[0];
  if (!call || typeof call[2] !== "function") {
    throw new Error("matchForKind was not called with a predicate");
  }
  return call[2];
}

beforeEach(() => {
  vi.clearAllMocks();
  h.loadUserAccess.mockImplementation(async () => access);
  h.matchForKind.mockResolvedValue({});
});

describe("documentExtraction matches", () => {
  it("compares only against what the uploader may read now", async () => {
    access = resolveAccess(["operations"], []);
    await run(USER);
    expect(h.loadUserAccess).toHaveBeenCalledWith(USER);
    expect(canRead()("transactions:read")).toBe(false);
    expect(canRead()("purchase_invoices:read")).toBe(false);
  });

  it("applies the uploader's denies", async () => {
    access = resolveAccess(["finance"], ["transactions:read"]);
    await run(USER);
    expect(canRead()("transactions:read")).toBe(false);
    expect(canRead()("purchase_invoices:read")).toBe(true);
  });

  it("compares nothing when the uploader is unknown", async () => {
    await run(null);
    expect(h.loadUserAccess).not.toHaveBeenCalled();
    expect(canRead()("invoices:read")).toBe(false);
  });
});
