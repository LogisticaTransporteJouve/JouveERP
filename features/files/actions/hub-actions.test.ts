import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Role } from "@/lib/auth/permissions";

// A PostgREST builder stand-in that records every filter and resolves to the
// rows the test set for the view.
type Call = [string, ...unknown[]];

let calls: Call[] = [];
let viewRows: Record<string, unknown>[] = [];
const signed = vi.fn(async () => ({
  data: { signedUrl: "https://storage/signed" },
  error: null,
}));

function builder(table: string): object {
  const target = {
    then(resolve: (v: unknown) => unknown) {
      return Promise.resolve(
        resolve({ data: table === "v_files_hub" ? viewRows : [], error: null }),
      );
    },
    maybeSingle: async () => {
      calls.push([`${table}.maybeSingle`]);
      if (table === "files") {
        return {
          data: {
            bucket: "files",
            bucket_path: "f.pdf",
            original_filename: "f.pdf",
            mime_type: "application/pdf",
          },
          error: null,
        };
      }
      return { data: viewRows[0] ?? null, error: null };
    },
  };
  const proxy: object = new Proxy(target, {
    get(t, prop) {
      if (prop in t) return Reflect.get(t, prop);
      return (...args: unknown[]) => {
        calls.push([`${table}.${String(prop)}`, ...args]);
        return proxy;
      };
    },
  });
  return proxy;
}

function client() {
  return {
    from: builder,
    storage: { from: () => ({ createSignedUrl: signed }) },
  };
}

const ctx: { userId: string; roles: Role[] } = {
  userId: "u-1",
  roles: ["finance"],
};

vi.mock("@/lib/auth/context", () => ({ requireUserContext: async () => ctx }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => client(),
}));

const { getHubFileUrlAction, listHubFilesAction } =
  await import("./hub-actions");

function row(i: number) {
  return {
    link_id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    entity_type: "purchase_invoice",
    entity_id: "e1",
    parent_id: null,
    kind: "comprobante",
    file_id: "f1",
    original_filename: `f${i}.pdf`,
    mime_type: "application/pdf",
    file_size: 10,
    uploaded_by: "u-2",
    uploader_name: "Ana Pérez",
    uploaded_at: `2026-10-${String(20 - i).padStart(2, "0")}T12:00:00+00:00`,
  };
}

function callsOf(method: string) {
  return calls.filter(([name]) => name === `v_files_hub.${method}`);
}

beforeEach(() => {
  calls = [];
  viewRows = [];
  ctx.userId = "u-1";
  ctx.roles = ["finance"];
  signed.mockClear();
});

describe("listHubFilesAction", () => {
  it("filters by the caller's entity types and own AI files", async () => {
    ctx.roles = ["operations"];
    const res = await listHubFilesAction({});
    expect(res).toEqual({ ok: true, data: { items: [], nextCursor: null } });
    expect(callsOf("in")).toEqual([
      [
        "v_files_hub.in",
        "entity_type",
        ["client", "supplier", "ai_document", "ai_chat_message"],
      ],
    ]);
    expect(callsOf("or")).toEqual([
      ["v_files_hub.or", "owner_id.is.null,owner_id.eq.u-1"],
    ]);
  });

  it("does not restrict owners for ai:admin", async () => {
    ctx.roles = ["admin"];
    await listHubFilesAction({});
    expect(callsOf("or")).toEqual([]);
  });

  it("never widens past the scope with a requested entity type", async () => {
    ctx.roles = ["operations"];
    const res = await listHubFilesAction({ entityType: "employee_document" });
    expect(res).toEqual({ ok: true, data: { items: [], nextCursor: null } });
    expect(calls).toEqual([]);
  });

  it("returns nothing (and runs no query) for roles without listable origins", async () => {
    ctx.roles = ["warehouse"];
    expect(await listHubFilesAction({})).toEqual({
      ok: true,
      data: { items: [], nextCursor: null },
    });
    expect(calls).toEqual([]);
    ctx.roles = ["driver"];
    expect((await listHubFilesAction({})).ok).toBe(false);
  });

  it("pages with a keyset cursor (limit + 1)", async () => {
    viewRows = [row(1), row(2), row(3)];
    const res = await listHubFilesAction({ limit: 2 });
    expect(callsOf("limit")).toEqual([["v_files_hub.limit", 3]]);
    expect(callsOf("order")).toEqual([
      ["v_files_hub.order", "uploaded_at", { ascending: false }],
      ["v_files_hub.order", "link_id", { ascending: false }],
    ]);
    if (!res.ok) throw new Error(res.error);
    expect(res.data.items.map((i) => i.filename)).toEqual(["f1.pdf", "f2.pdf"]);
    expect(res.data.nextCursor).toEqual({
      uploadedAt: row(2).uploaded_at,
      linkId: row(2).link_id,
    });

    calls = [];
    viewRows = [row(3)];
    const next = await listHubFilesAction({
      limit: 2,
      cursor: res.data.nextCursor,
    });
    const [or] = callsOf("or");
    expect(or?.[1]).toContain(`link_id.lt.${row(2).link_id}`);
    expect(next.ok && next.data.nextCursor).toBeNull();
  });

  it("applies search, type, uploader and date filters", async () => {
    await listHubFilesAction({
      search: "fact_ura",
      fileKind: "image",
      uploadedBy: "22222222-2222-4222-8222-222222222222",
      dateFrom: "2026-10-01",
      dateTo: "2026-10-31",
    });
    expect(callsOf("ilike")).toEqual([
      ["v_files_hub.ilike", "original_filename", "%fact\\_ura%"],
    ]);
    expect(callsOf("like")).toEqual([
      ["v_files_hub.like", "mime_type", "image/%"],
    ]);
    expect(callsOf("eq")).toEqual([
      ["v_files_hub.eq", "uploaded_by", "22222222-2222-4222-8222-222222222222"],
    ]);
    expect(callsOf("gte")).toEqual([
      ["v_files_hub.gte", "uploaded_at", "2026-10-01T00:00:00-03:00"],
    ]);
    expect(callsOf("lt")).toEqual([
      ["v_files_hub.lt", "uploaded_at", "2026-11-01T00:00:00-03:00"],
    ]);
  });

  it("drops rows of unknown origin and rejects bad input", async () => {
    viewRows = [{ ...row(1), entity_type: "something_else" }, row(2)];
    const res = await listHubFilesAction({});
    expect(res.ok && res.data.items.map((i) => i.filename)).toEqual(["f2.pdf"]);
    expect((await listHubFilesAction({ cursor: { uploadedAt: "x" } })).ok).toBe(
      false,
    );
  });
});

describe("getHubFileUrlAction", () => {
  it("signs only a row visible in the caller's scope", async () => {
    ctx.roles = ["operations"];
    viewRows = [row(1)];
    const res = await getHubFileUrlAction(row(1).link_id, { download: true });
    expect(res).toEqual({
      ok: true,
      data: {
        url: "https://storage/signed",
        filename: "f.pdf",
        mimeType: "application/pdf",
      },
    });
    expect(callsOf("in")[0]?.[2]).toEqual([
      "client",
      "supplier",
      "ai_document",
      "ai_chat_message",
    ]);
    expect(callsOf("or")).toEqual([
      ["v_files_hub.or", "owner_id.is.null,owner_id.eq.u-1"],
    ]);
    expect(signed).toHaveBeenCalledWith("f.pdf", 3600, { download: "f.pdf" });
  });

  it("refuses when the scoped lookup finds nothing", async () => {
    viewRows = [];
    expect(await getHubFileUrlAction(row(1).link_id)).toEqual({
      ok: false,
      error: "Archivo no encontrado.",
    });
    expect(signed).not.toHaveBeenCalled();
  });

  it("refuses roles that can list no origin", async () => {
    ctx.roles = ["warehouse"];
    viewRows = [row(1)];
    expect((await getHubFileUrlAction(row(1).link_id)).ok).toBe(false);
    expect(calls).toEqual([]);
  });
});
