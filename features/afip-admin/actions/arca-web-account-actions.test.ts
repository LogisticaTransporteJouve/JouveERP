import { beforeEach, describe, expect, it, vi } from "vitest";

import { isRole, resolveAccess } from "@/lib/auth/permissions";

let roles: string[] = ["owner"];
let account: Record<string, unknown> | null = null;
const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
const audit = vi.fn();
const logged: unknown[] = [];

const service = {
  from: () => ({
    select: () => ({
      maybeSingle: async () => ({ data: account, error: null }),
    }),
  }),
  rpc: async (fn: string, args: Record<string, unknown>) => {
    rpcCalls.push({ fn, args });
    return { data: null, error: null };
  },
};

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(roles.filter(isRole)),
  }),
}));
vi.mock("@/lib/supabase/service", () => ({ getServiceClient: () => service }));
vi.mock("@/lib/actions/audit", () => ({
  logAudit: (...args: unknown[]) => audit(...args),
}));
vi.mock("@/lib/logger", () => ({
  logger: {
    error: (...args: unknown[]) => logged.push(args),
    info: (...args: unknown[]) => logged.push(args),
  },
}));

const { getArcaWebAccountAction, setArcaWebCredentialsAction } =
  await import("./arca-web-account-actions");

const CUIT = "20-12345678-6";

beforeEach(() => {
  roles = ["owner"];
  account = null;
  rpcCalls.length = 0;
  audit.mockClear();
  logged.length = 0;
});

describe("setArcaWebCredentialsAction", () => {
  it("does not save the same CUIT alone on a stopped account", async () => {
    account = {
      cuit: "20123456786",
      status: "sign_in_failing",
      secret_id: "s1",
      updated_at: "2026-11-04T08:00:00Z",
      last_success_at: null,
      last_error_code: "NETWORK",
    };
    const res = await setArcaWebCredentialsAction({
      cuit: CUIT,
      password: "",
    });
    expect(res.ok ? null : res.error).toMatch(/cargá la clave/);
    expect(rpcCalls).toEqual([]);
  });

  it("refuses a role without afip:admin", async () => {
    roles = ["finance"];
    const res = await setArcaWebCredentialsAction({
      cuit: CUIT,
      password: "x",
    });
    expect(res.ok).toBe(false);
    expect(rpcCalls).toEqual([]);
  });

  it("refuses an invalid CUIT", async () => {
    const res = await setArcaWebCredentialsAction({
      cuit: "20-12345678-0",
      password: "x",
    });
    expect(res).toEqual({ ok: false, error: "CUIT inválido." });
  });

  it("needs a clave the first time", async () => {
    const res = await setArcaWebCredentialsAction({ cuit: CUIT, password: "" });
    expect(res).toEqual({ ok: false, error: "Falta la clave." });
    expect(rpcCalls).toEqual([]);
  });

  it("sends the clave to the RPC only, never to the audit or the logs", async () => {
    const res = await setArcaWebCredentialsAction({
      cuit: CUIT,
      password: "s3creta",
    });
    expect(res.ok).toBe(true);
    expect(rpcCalls).toEqual([
      {
        fn: "set_arca_web_credentials",
        args: { p_cuit: "20123456786", p_user_id: "u1", p_password: "s3creta" },
      },
    ]);
    expect(audit).toHaveBeenCalledWith(
      "afip.arca_web_credentials_saved",
      "u1",
      {
        cuitChanged: true,
        passwordChanged: true,
      },
    );
    expect(JSON.stringify([audit.mock.calls, logged])).not.toContain("s3creta");
  });

  it("keeps the stored clave when the field is left empty", async () => {
    account = {
      cuit: "20123456786",
      status: "active",
      secret_id: "s1",
      last_success_at: null,
      last_error_code: null,
    };
    await setArcaWebCredentialsAction({ cuit: CUIT, password: "" });
    expect(rpcCalls[0]?.args).toEqual({
      p_cuit: "20123456786",
      p_user_id: "u1",
    });
    expect(audit).toHaveBeenCalledWith(
      "afip.arca_web_credentials_saved",
      "u1",
      {
        cuitChanged: false,
        passwordChanged: false,
      },
    );
  });
});

describe("getArcaWebAccountAction", () => {
  it("reports the state without the secret", async () => {
    account = {
      cuit: "20123456786",
      status: "sign_in_failing",
      secret_id: "s1",
      last_success_at: null,
      last_error_code: "SIGN_IN_REJECTED",
    };
    const res = await getArcaWebAccountAction();
    expect(res).toEqual({
      ok: true,
      data: {
        state: "rejected",
        cuit: "20123456786",
        lastSuccessAt: null,
        lastErrorCode: "SIGN_IN_REJECTED",
        sync: {
          requestedAt: null,
          startedAt: null,
          finishedAt: null,
          result: null,
        },
      },
    });
  });
});
