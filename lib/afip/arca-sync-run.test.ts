import { describe, expect, it } from "vitest";

import { syncPhase, syncResultText } from "@/lib/afip/arca-sync-run";

const t = (iso: string) => `2026-11-04T09:${iso}:00.000Z`;
const now = Date.parse(t("10"));
const idle = {
  requestedAt: null,
  startedAt: null,
  finishedAt: null,
  result: null,
};

describe("syncPhase", () => {
  it("follows a requested run until it ends", () => {
    expect(syncPhase(idle, now)).toBe("idle");
    expect(syncPhase({ ...idle, requestedAt: t("09") }, now)).toBe("waiting");
    expect(
      syncPhase({ ...idle, requestedAt: t("09"), startedAt: t("09") }, now),
    ).toBe("running");
    expect(
      syncPhase(
        {
          ...idle,
          requestedAt: t("08"),
          startedAt: t("09"),
          finishedAt: t("09"),
        },
        now,
      ),
    ).toBe("idle");
  });

  it("says when a request never started, or a run never ended", () => {
    expect(syncPhase({ ...idle, requestedAt: t("05") }, now)).toBe(
      "not_started",
    );
    expect(
      syncPhase({ ...idle, startedAt: "2026-11-04T08:30:00.000Z" }, now),
    ).toBe("died");
  });

  it("follows the daily run too, which has no request", () => {
    expect(
      syncPhase({ ...idle, startedAt: t("09"), finishedAt: t("01") }, now),
    ).toBe("running");
  });
});

describe("syncResultText", () => {
  it("counts what came in and names the months that failed", () => {
    expect(
      syncResultText({
        outcome: "done",
        counts: { inserted: 14, unsupported: 0, alreadyInTray: 0, linked: 2 },
        skippedRows: 0,
        failedMonths: { "2026-10": "TOO_MANY" },
      }),
    ).toBe(
      "14 comprobantes nuevos · 0 ya estaban · 2 ya cargados como compra. Faltó 2026-10 (demasiados comprobantes en el mes).",
    );
    expect(
      syncResultText({ outcome: "sign_in_failed", code: "SIGN_IN_REJECTED" }),
    ).toBe("No se pudo entrar a ARCA: ARCA rechazó el CUIT o la clave.");
  });
});
