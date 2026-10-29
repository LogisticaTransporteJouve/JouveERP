import { beforeEach, describe, expect, it, vi } from "vitest";

import { type Access, type Role, resolveAccess } from "@/lib/auth/permissions";

import type { ChatAttachmentFile } from "./store";

const FILE_ID = "11111111-1111-4111-8111-111111111111";

const ctx: { userId: string; access: Access } = {
  userId: "u-owner",
  access: resolveAccess(["finance"]),
};
const store = {
  loadChatAttachmentFile:
    vi.fn<(id: string) => Promise<ChatAttachmentFile | null>>(),
  signStoredFile: vi.fn(async () => "https://storage/signed"),
  storeDraftAttachment: vi.fn(async () => true),
  deleteDraftAttachment: vi.fn(async () => true),
};

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ctx,
}));
vi.mock("@/lib/rate-limit", () => ({
  RateLimitError: class extends Error {},
  enforceRateLimit: vi.fn(async () => undefined),
}));
vi.mock("./store", () => store);

const {
  discardChatAttachmentAction,
  getChatAttachmentUrlAction,
  uploadChatAttachmentAction,
} = await import("./actions");

function sentFile(sessionOwner: string | null): ChatAttachmentFile {
  return {
    fileId: FILE_ID,
    bucket: "files",
    bucketPath: `${FILE_ID}.pdf`,
    filename: "factura.pdf",
    mimeType: "application/pdf",
    source: "chat_attachment",
    uploadedBy: "u-owner",
    sessionOwner,
  };
}

function form(name: string, type: string, content: string) {
  const fd = new FormData();
  fd.append("file", new File([content], name, { type }));
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  ctx.userId = "u-owner";
  ctx.access = resolveAccess(["finance"]);
});

describe("getChatAttachmentUrlAction", () => {
  it("signs for the session owner", async () => {
    store.loadChatAttachmentFile.mockResolvedValue(sentFile("u-owner"));
    const res = await getChatAttachmentUrlAction(FILE_ID);
    expect(res).toEqual({
      ok: true,
      data: {
        url: "https://storage/signed",
        filename: "factura.pdf",
        mimeType: "application/pdf",
      },
    });
  });

  it("refuses another user, even with files:read", async () => {
    store.loadChatAttachmentFile.mockResolvedValue(sentFile("u-owner"));
    ctx.userId = "u-other";
    ctx.access = resolveAccess(["finance"]);
    const res = await getChatAttachmentUrlAction(FILE_ID);
    expect(res).toEqual({ ok: false, error: "Archivo no encontrado." });
    expect(store.signStoredFile).not.toHaveBeenCalled();
  });

  it("lets ai:admin open another user's sent attachment", async () => {
    store.loadChatAttachmentFile.mockResolvedValue(sentFile("u-owner"));
    ctx.userId = "u-admin";
    ctx.access = resolveAccess(["admin"]);
    expect((await getChatAttachmentUrlAction(FILE_ID)).ok).toBe(true);
  });

  it("refuses roles without ai:chat and invalid ids", async () => {
    ctx.access = resolveAccess(["warehouse"]);
    expect(await getChatAttachmentUrlAction(FILE_ID)).toEqual({
      ok: false,
      error: "No tenés permiso para usar el chat de IA.",
    });
    ctx.access = resolveAccess(["finance"]);
    expect(await getChatAttachmentUrlAction("../x")).toEqual({
      ok: false,
      error: "ID inválido.",
    });
    expect(store.loadChatAttachmentFile).not.toHaveBeenCalled();
  });

  it("never signs a non-chat file", async () => {
    store.loadChatAttachmentFile.mockResolvedValue({
      ...sentFile(null),
      source: "manual_upload",
    });
    expect((await getChatAttachmentUrlAction(FILE_ID)).ok).toBe(false);
  });
});

describe("uploadChatAttachmentAction", () => {
  it("stores a valid PDF as a draft with its page count", async () => {
    const pdf =
      "%PDF-1.4\n1 0 obj <</Type /Page>> endobj\n2 0 obj <</Type /Page>> endobj";
    const res = await uploadChatAttachmentAction(
      form("factura.pdf", "application/pdf", pdf),
    );
    expect(res.ok).toBe(true);
    expect(store.storeDraftAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u-owner",
        filename: "factura.pdf",
        mimeType: "application/pdf",
        metadata: { pages: 2 },
      }),
    );
  });

  it("normalizes a CSV the browser labels as Excel", async () => {
    const res = await uploadChatAttachmentAction(
      form("ventas.csv", "application/vnd.ms-excel", "a;b\n1;2\n"),
    );
    expect(res.ok && res.data.mimeType).toBe("text/csv");
  });

  it("rejects content that does not match the type", async () => {
    const res = await uploadChatAttachmentAction(
      form("factura.pdf", "application/pdf", "<html>no soy un pdf</html>"),
    );
    expect(res).toEqual({
      ok: false,
      error: "El contenido del archivo no coincide con su tipo.",
    });
    expect(store.storeDraftAttachment).not.toHaveBeenCalled();
  });

  it("rejects PDFs over the page cap and unreadable spreadsheets", async () => {
    const pages = Array.from(
      { length: 21 },
      (_, i) => `${i + 1} 0 obj <</Type /Page>> endobj`,
    ).join("\n");
    expect(
      await uploadChatAttachmentAction(
        form("largo.pdf", "application/pdf", `%PDF-1.4 ${pages}`),
      ),
    ).toEqual({
      ok: false,
      error: "El PDF tiene 21 páginas; el máximo para el chat es 20.",
    });
    expect(
      await uploadChatAttachmentAction(
        form(
          "planilla.xlsx",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "PK\u0003\u0004 roto",
        ),
      ),
    ).toEqual({ ok: false, error: "No se pudo leer la planilla." });
  });

  it("rejects disallowed types before touching storage", async () => {
    const res = await uploadChatAttachmentAction(
      form("viejo.xls", "application/vnd.ms-excel", "x"),
    );
    expect(res.ok).toBe(false);
    expect(store.storeDraftAttachment).not.toHaveBeenCalled();
  });

  it("requires ai:chat and files:write", async () => {
    ctx.access = resolveAccess(["warehouse"]);
    const res = await uploadChatAttachmentAction(
      form("a.pdf", "application/pdf", "%PDF-1.4"),
    );
    expect(res.ok).toBe(false);
  });
});

describe("uploadChatAttachmentAction caps", () => {
  it("rejects encrypted PDFs and images over the model's limit", async () => {
    expect(
      await uploadChatAttachmentAction(
        form(
          "secreto.pdf",
          "application/pdf",
          "%PDF-1.4\n1 0 obj <</Type /Page>> endobj\ntrailer <</Root 2 0 R /Encrypt 5 0 R>>",
        ),
      ),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining("contraseña"),
    });
    const big = "\x89PNG\r\n\x1a\n".padEnd(3.8 * 1024 * 1024, "x");
    expect(
      await uploadChatAttachmentAction(form("foto.png", "image/png", big)),
    ).toMatchObject({ ok: false, error: expect.stringContaining("3,7 MB") });
    expect(store.storeDraftAttachment).not.toHaveBeenCalled();
  });

  it("caches a spreadsheet's table in the file metadata", async () => {
    await uploadChatAttachmentAction(form("v.csv", "text/csv", "a;b\n1;2\n"));
    expect(store.storeDraftAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: {
          rows: 2,
          table: {
            rows: [
              ["a", "b"],
              ["1", "2"],
            ],
            truncated: false,
          },
        },
      }),
    );
  });
});

describe("discardChatAttachmentAction", () => {
  it("deletes only through the owner-checked store call", async () => {
    await discardChatAttachmentAction(FILE_ID);
    expect(store.deleteDraftAttachment).toHaveBeenCalledWith(
      "u-owner",
      FILE_ID,
    );
  });
});
