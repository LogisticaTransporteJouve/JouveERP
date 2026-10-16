import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatAttachmentFile } from "../../attachments/store";

const FILE_ID = "11111111-1111-4111-8111-111111111111";

const store = {
  findOwnSentAttachment: vi.fn<() => Promise<ChatAttachmentFile | null>>(),
  hasDocumentExtraction: vi.fn(async () => false),
};
const startDocumentExtraction = vi.fn(async () => ({
  ok: true as const,
  data: { extractionId: "ext-1" },
}));

vi.mock("../../attachments/store", () => store);
vi.mock("../../document/start", () => ({ startDocumentExtraction }));

const { proposeDocumentScan } = await import("./documents");

const createRevision = vi.fn(async () => ({ id: "conf-1", revision: 1 }));
const ctx = {
  userId: "u-owner",
  roles: ["finance" as const],
  proposals: { createRevision },
};

function file(mimeType: string): ChatAttachmentFile {
  return {
    fileId: FILE_ID,
    bucket: "files",
    bucketPath: `${FILE_ID}.pdf`,
    filename: "factura.pdf",
    mimeType,
    source: "chat_attachment",
    uploadedBy: "u-owner",
    sessionOwner: "u-owner",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  store.findOwnSentAttachment.mockResolvedValue(file("application/pdf"));
});

describe("proposeDocumentScan", () => {
  it("parks a draft for the caller's own PDF attachment", async () => {
    const res = await proposeDocumentScan.execute(
      ctx,
      { fileId: FILE_ID, declared_type: "purchase_invoice" },
      { toolCallId: "call-1" },
    );
    expect(res.ok).toBe(true);
    expect(store.findOwnSentAttachment).toHaveBeenCalledWith(
      "u-owner",
      FILE_ID,
    );
    expect(createRevision).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "proposeDocumentScan",
        draft: { file_id: FILE_ID, declared_type: "purchase_invoice" },
        labels: { [FILE_ID]: "factura.pdf" },
      }),
    );
    expect(startDocumentExtraction).not.toHaveBeenCalled();
  });

  it("refuses files that are not the caller's chat attachments", async () => {
    store.findOwnSentAttachment.mockResolvedValue(null);
    const res = await proposeDocumentScan.execute(
      ctx,
      { fileId: FILE_ID },
      { toolCallId: "call-1" },
    );
    expect(res).toMatchObject({ ok: false });
    expect(createRevision).not.toHaveBeenCalled();
  });

  it("refuses spreadsheets and files already sent to Documentos", async () => {
    store.findOwnSentAttachment.mockResolvedValueOnce(file("text/csv"));
    expect(
      await proposeDocumentScan.execute(
        ctx,
        { fileId: FILE_ID },
        { toolCallId: "c" },
      ),
    ).toMatchObject({ ok: false });
    store.hasDocumentExtraction.mockResolvedValueOnce(true);
    expect(
      await proposeDocumentScan.execute(
        ctx,
        { fileId: FILE_ID },
        { toolCallId: "c" },
      ),
    ).toMatchObject({
      ok: false,
      error: "Ese archivo ya se mandó a Documentos.",
    });
  });

  it("is not offered without ai:read + files:write", async () => {
    const res = await proposeDocumentScan.execute(
      { ...ctx, roles: ["warehouse"] },
      { fileId: FILE_ID },
      { toolCallId: "c" },
    );
    expect(res).toMatchObject({ ok: false });
    expect(store.findOwnSentAttachment).not.toHaveBeenCalled();
  });

  it("on confirm re-checks ownership and starts the extraction", async () => {
    const res = await proposeDocumentScan.proposal?.executeDraft(ctx, {
      file_id: FILE_ID,
      declared_type: "auto",
    });
    expect(res).toEqual({ ok: true, data: { id: "ext-1" } });
    expect(startDocumentExtraction).toHaveBeenCalledWith("u-owner", {
      fileId: FILE_ID,
      declaredType: null,
    });

    store.findOwnSentAttachment.mockResolvedValue(null);
    expect(
      await proposeDocumentScan.proposal?.executeDraft(ctx, {
        file_id: FILE_ID,
        declared_type: "receipt",
      }),
    ).toEqual({ ok: false, error: "El adjunto ya no está disponible." });
  });
});
