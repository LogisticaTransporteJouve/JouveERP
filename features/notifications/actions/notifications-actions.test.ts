import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  logError: vi.fn(),
  dbError: {
    code: "42703",
    message: "column notifications.secret_col does not exist",
  },
}));

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({ userId: "u1" }),
}));
vi.mock("@/lib/logger", () => ({
  logger: { error: h.logError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    const b = {
      update: () => b,
      eq: () => b,
      then: (resolve: (v: unknown) => unknown) =>
        resolve({ data: null, error: h.dbError }),
    };
    return {
      rpc: async () => ({ data: null, error: h.dbError }),
      from: () => b,
    };
  },
}));

const {
  listNotificationsAction,
  getUnreadCountAction,
  markNotificationReadAction,
  markAllReadAction,
} = await import("./notifications-actions");

beforeEach(() => {
  h.logError.mockReset();
});

describe("notifications actions on a database error", () => {
  it.each([
    [
      "list",
      () => listNotificationsAction({}),
      "notifications.list.failed",
      "No se pudieron leer los avisos.",
    ],
    [
      "unread count",
      () => getUnreadCountAction(),
      "notifications.unread_count.failed",
      "No se pudo leer la cantidad de avisos.",
    ],
    [
      "mark read",
      () => markNotificationReadAction("11111111-1111-4111-8111-111111111111"),
      "notifications.mark_read.failed",
      "No se pudo marcar el aviso como leído.",
    ],
    [
      "mark all read",
      () => markAllReadAction(),
      "notifications.mark_all_read.failed",
      "No se pudieron marcar los avisos como leídos.",
    ],
  ])(
    "%s logs the error and answers a fixed message",
    async (_, run, event, error) => {
      expect(await run()).toEqual({ ok: false, error });
      expect(h.logError).toHaveBeenCalledWith(event, { error: h.dbError });
    },
  );
});
