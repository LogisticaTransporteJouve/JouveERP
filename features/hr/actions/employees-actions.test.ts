import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";

let storedNotes: string | null = null;
const update = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(["admin"]),
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { notes: storedNotes },
            error: null,
          }),
        }),
      }),
      update: (patch: unknown) => {
        update(patch);
        return { eq: async () => ({ error: null }) };
      },
    }),
  }),
}));
vi.mock("@/lib/actions/audit", () => ({ logAudit: vi.fn() }));
vi.mock("../lib/employee-driver", () => ({
  deactivateEmployeeDriver: async () => ({ ok: true }),
  readEmployeeDriver: vi.fn(),
  syncEmployeeDriver: vi.fn(),
}));
vi.mock("../lib/vacation-opening", () => ({ applyVacationOpening: vi.fn() }));

const { terminateEmployeeAction } = await import("./employees-actions");

const EMP = "00000000-0000-4000-8000-000000000001";

beforeEach(() => {
  storedNotes = null;
  update.mockClear();
});

describe("terminateEmployeeAction: notes", () => {
  it("appends the reason to the notes the employee already had", async () => {
    storedNotes = "Ingresó por recomendación.";
    const res = await terminateEmployeeAction({
      id: EMP,
      termination_date: "2026-11-05",
      notes: "Renuncia.",
    });
    expect(res.ok).toBe(true);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        is_active: false,
        notes: "Ingresó por recomendación.\n\nRenuncia.",
      }),
    );
  });

  it("writes the reason alone when there were no notes", async () => {
    await terminateEmployeeAction({
      id: EMP,
      termination_date: "2026-11-05",
      notes: "Renuncia.",
    });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ notes: "Renuncia." }),
    );
  });

  it("keeps the notes untouched without a reason", async () => {
    storedNotes = "Ingresó por recomendación.";
    await terminateEmployeeAction({
      id: EMP,
      termination_date: "2026-11-05",
      notes: null,
    });
    expect(update.mock.calls[0]?.[0]).not.toHaveProperty("notes");
  });
});
