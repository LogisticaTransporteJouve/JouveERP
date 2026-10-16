import { beforeEach, describe, expect, it, vi } from "vitest";

const FILE_ID = "11111111-1111-4111-8111-111111111111";
let deleted: { bucket: string; bucket_path: string }[] = [];
const rpc = vi.fn(async () => ({ data: deleted, error: null }));
const remove = vi.fn(async () => ({ error: null }));

vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => ({ rpc, storage: { from: () => ({ remove }) } }),
}));

const { deleteDraftAttachment } = await import("./store");

beforeEach(() => {
  vi.clearAllMocks();
  deleted = [];
});

describe("deleteDraftAttachment", () => {
  it("deletes through the conditional RPC, then the blob", async () => {
    deleted = [{ bucket: "files", bucket_path: `${FILE_ID}.pdf` }];
    expect(await deleteDraftAttachment("u1", FILE_ID)).toBe(true);
    expect(rpc).toHaveBeenCalledWith("delete_chat_draft_file", {
      p_file_id: FILE_ID,
      p_user_id: "u1",
    });
    expect(remove).toHaveBeenCalledWith([`${FILE_ID}.pdf`]);
  });

  it("leaves the blob alone when the RPC kept the file", async () => {
    expect(await deleteDraftAttachment("u1", FILE_ID)).toBe(false);
    expect(remove).not.toHaveBeenCalled();
  });
});
