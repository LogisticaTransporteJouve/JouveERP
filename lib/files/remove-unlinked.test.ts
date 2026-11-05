import { beforeEach, describe, expect, it, vi } from "vitest";

const FILE_ID = "33333333-3333-4333-8333-333333333333";
const NEXT_ID = "44444444-4444-4444-8444-444444444444";
const DOC_ID = "66666666-6666-4666-8666-666666666666";

let rpcResult: {
  data: { id: string; bucket: string; bucket_path: string }[] | null;
  error: { message: string } | null;
} = { data: [], error: null };
const rpc = vi.fn(async () => rpcResult);
const storageRemove = vi.fn(async () => ({ error: null }));
const storageFrom = vi.fn(() => ({ remove: storageRemove }));
const logAudit = vi.fn(async () => undefined);

vi.mock("server-only", () => ({}));
vi.mock("@/lib/actions/audit", () => ({ logAudit }));
vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => ({ rpc, storage: { from: storageFrom } }),
}));

const { removeReplacedFile } = await import("./remove-unlinked");

const input = {
  userId: "u1",
  auditEvent: "fleet_document.file_removed",
  documentId: DOC_ID,
  previousFileId: FILE_ID,
  nextFileId: NEXT_ID,
};

beforeEach(() => {
  vi.clearAllMocks();
  rpcResult = {
    data: [{ id: FILE_ID, bucket: "files", bucket_path: `${FILE_ID}.pdf` }],
    error: null,
  };
});

describe("removeReplacedFile (audit w13-s4 F2)", () => {
  it("deletes the unlinked file's row with the sweep's rules and no age margin, then its bytes, and audits it", async () => {
    await removeReplacedFile(input);
    expect(rpc).toHaveBeenCalledWith("delete_orphan_files", {
      p_ids: [FILE_ID],
      p_max_age: "0 seconds",
    });
    expect(storageFrom).toHaveBeenCalledWith("files");
    expect(storageRemove).toHaveBeenCalledWith([`${FILE_ID}.pdf`]);
    expect(logAudit).toHaveBeenCalledWith(
      "fleet_document.file_removed",
      "u1",
      { file_id: FILE_ID },
      DOC_ID,
    );
  });

  it("keeps a file something else still links (the delete returns nothing)", async () => {
    rpcResult = { data: [], error: null };
    await removeReplacedFile(input);
    expect(storageRemove).not.toHaveBeenCalled();
    expect(logAudit).not.toHaveBeenCalled();
  });

  it("leaves the file to the sweep when the delete fails", async () => {
    rpcResult = { data: null, error: { message: "timeout" } };
    await expect(removeReplacedFile(input)).resolves.toBeUndefined();
    expect(storageRemove).not.toHaveBeenCalled();
    expect(logAudit).not.toHaveBeenCalled();
  });

  it("does nothing when there was no file or it did not change", async () => {
    await removeReplacedFile({ ...input, previousFileId: null });
    await removeReplacedFile({ ...input, nextFileId: FILE_ID });
    expect(rpc).not.toHaveBeenCalled();
  });
});
