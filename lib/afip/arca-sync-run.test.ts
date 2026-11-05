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
    expect(syncPhase({ ...idle, requestedAt: t("01") }, now)).toBe(
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

  it("keeps waiting while a run that started before the request ends", () => {
    expect(
      syncPhase(
        {
          ...idle,
          startedAt: t("01"),
          finishedAt: t("09"),
          requestedAt: t("05"),
        },
        now,
      ),
    ).toBe("waiting");
  });

  it("groups consecutive failed months and names the rows not read", () => {
    // The owner's run: Dec 2014 to Nov 2015, a wrong year in the picker.
    const failedMonths: Record<string, string> = {};
    for (const m of [
      "2014-12",
      "2015-01",
      "2015-02",
      "2015-03",
      "2015-04",
      "2015-05",
      "2015-06",
      "2015-07",
      "2015-08",
      "2015-09",
      "2015-10",
    ]) {
      failedMonths[m] = "QUERY_REFUSED";
    }
    failedMonths["2015-11"] = "PERIOD_MISMATCH";
    expect(
      syncResultText({
        outcome: "done",
        counts: { inserted: 0, unsupported: 0, alreadyInTray: 0, linked: 0 },
        skippedRows: 4,
        skipped: [
          {
            month: "2026-11",
            reason: "amount_mismatch",
            ref: "tipo 1 · 00003-00026630",
          },
          {
            month: "2026-11",
            reason: "bad_cuit",
            ref: "tipo 11 · 00002-00000108",
          },
        ],
        failedMonths,
      }),
    ).toBe(
      "0 comprobantes nuevos · 0 ya estaban · 4 no se pudieron leer. " +
        "Faltó 2014-12 a 2015-10 (ARCA rechazó la consulta), " +
        "2015-11 (ARCA devolvió otro período y no se usó). " +
        "No se leyeron: tipo 1 · 00003-00026630 (los importes no suman el total); " +
        "tipo 11 · 00002-00000108 (CUIT ilegible) y 2 más.",
    );
  });
});
