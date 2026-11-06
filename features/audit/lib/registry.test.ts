import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import type { JsonValue } from "@/lib/actions/audit";

import type { AuditEntity, EntityKind } from "./entities";
import {
  AUDIT_ACTION_TYPES,
  AUDIT_GROUPS,
  auditEventTypesOf,
  auditGroupOf,
  auditSentence,
  humanizeEventType,
  type SentenceInput,
} from "./registry";

// Every action written to audit_events (by a logAudit call or by a SQL
// function) has a sentence in the registry. A new logAudit("x.y", …) without
// one fails here.

const ROOT = join(__dirname, "..", "..", "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "node_modules" ? [] : sourceFiles(path);
    }
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
      ? [path]
      : [];
  });
}

/** The text of a call's first argument, from just after `logAudit(`. */
function firstArgument(source: string, start: number): string {
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    const c = source[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      if (depth === 0) return source.slice(start, i);
      depth--;
    } else if (c === "," && depth === 0) return source.slice(start, i);
  }
  return source.slice(start);
}

const EVENT_LITERAL = /["'`]([a-z0-9_]+(?:\.[a-z0-9_]+)+)["'`]/g;

/** Actions built at runtime, with every value they can take. */
const DYNAMIC: Record<string, string[]> = {
  // IssuedCheckTransitionSchema.to_status
  "`issued_check.${parsed.data.to_status}`": [
    "issued_check.cashed",
    "issued_check.rejected",
    "issued_check.cancelled",
  ],
  // the insight status input: only "acknowledged" passes the guard
  "`ai.insight.${input.status}`": ["ai.insight.acknowledged"],
};

type Found = { file: string; arg: string };

function loggedActions(): { actions: Set<string>; unknown: Found[] } {
  const actions = new Set<string>();
  const unknown: Found[] = [];
  const files = ["app", "features", "lib"].flatMap((d) =>
    sourceFiles(join(ROOT, d)),
  );
  for (const path of files) {
    const source = readFileSync(path, "utf8");
    const file = relative(ROOT, path);
    // Values handed to a helper that logs them (lib/files/remove-unlinked).
    for (const m of source.matchAll(/auditEvent:\s*("[^"]+"|[A-Z_]+)/g)) {
      const value = m[1] ?? "";
      const literal = value.startsWith('"')
        ? value.slice(1, -1)
        : new RegExp(`const ${value} = "([^"]+)"`).exec(source)?.[1];
      if (literal) actions.add(literal);
      else unknown.push({ file, arg: value });
    }
    let at = source.indexOf("logAudit(");
    while (at >= 0) {
      const before = source.slice(Math.max(0, at - 20), at);
      if (!/function\s*$/.test(before)) {
        const arg = firstArgument(source, at + "logAudit(".length).trim();
        const dynamic = DYNAMIC[arg];
        const literals = [...arg.matchAll(EVENT_LITERAL)].map(
          (m) => m[1] ?? "",
        );
        if (dynamic) dynamic.forEach((a) => actions.add(a));
        else if (arg === "input.auditEvent") {
          // collected from the callers' `auditEvent:` above
        } else if (literals.length > 0 && !arg.includes("${")) {
          literals.forEach((a) => actions.add(a));
        } else unknown.push({ file, arg });
      }
      at = source.indexOf("logAudit(", at + 1);
    }
  }
  return { actions, unknown };
}

function sqlActions(): Set<string> {
  const dir = join(ROOT, "supabase", "migrations");
  const out = new Set<string>();
  for (const name of readdirSync(dir)) {
    const source = readFileSync(join(dir, name), "utf8");
    for (const m of source.matchAll(
      /insert into public\.audit_events[\s\S]{0,300}?'([a-z_]+(?:\.[a-z_]+)+)'/gi,
    )) {
      out.add(m[1] ?? "");
    }
  }
  return out;
}

describe("audit action registry coverage", () => {
  const { actions, unknown } = loggedActions();

  it("finds the logged actions", () => {
    expect(actions.size).toBeGreaterThan(200);
  });

  it("reads every logAudit call's action (add a runtime-built one to DYNAMIC)", () => {
    expect(unknown).toEqual([]);
  });

  it("has a sentence for every action the app logs", () => {
    const missing = [...actions].filter((a) => !AUDIT_ACTION_TYPES.includes(a));
    expect(missing).toEqual([]);
  });

  it("has a sentence for every action SQL functions log", () => {
    const sql = sqlActions();
    expect(sql.size).toBeGreaterThan(0);
    const missing = [...sql].filter((a) => !AUDIT_ACTION_TYPES.includes(a));
    expect(missing).toEqual([]);
  });

  it("puts every action in a «Qué» group", () => {
    const grouped = AUDIT_GROUPS.flatMap((g) => auditEventTypesOf(g.id));
    expect(new Set(grouped).size).toBe(AUDIT_ACTION_TYPES.length);
  });
});

function entity(
  kind: EntityKind,
  label: string,
  extra: Partial<AuditEntity> = {},
): AuditEntity {
  return {
    kind,
    id: "x",
    label,
    party: null,
    amount: null,
    href: null,
    ...extra,
  };
}

function input(
  p: { [k: string]: JsonValue | undefined },
  opts: {
    subject?: AuditEntity | null;
    refs?: Record<string, AuditEntity>;
    targetUser?: string | null;
  } = {},
): SentenceInput {
  return {
    p,
    subject: opts.subject ?? null,
    ref: (_kind, id) =>
      typeof id === "string" ? (opts.refs?.[id] ?? null) : null,
    targetUser: opts.targetUser ?? null,
  };
}

describe("audit sentences", () => {
  it("never leaks code words, empty slots or raw JSON, with or without data", () => {
    for (const type of AUDIT_ACTION_TYPES) {
      for (const p of [{}, { fields: ["notes", "weird_column"], amount: 10 }]) {
        const sentence = auditSentence(type, input(p));
        expect(sentence, type).not.toMatch(
          /undefined|null|NaN|\[object|\{|\}|\$\{|_id\b/,
        );
        expect(sentence.trim(), type).toBe(sentence);
        expect(sentence, type).not.toContain("  ");
        expect(sentence.length, type).toBeGreaterThan(5);
      }
    }
  });

  it("says who got the invoice and for how much", () => {
    const subject = entity("invoice", "la Factura A 0003-00022312", {
      party: "TRANSPORTES SUR SA",
      amount: "$ 1.234.567,00",
    });
    expect(
      auditSentence(
        "invoice.issue_requested",
        input({ kind: "factura", imp_total: 1234567 }, { subject }),
      ),
    ).toBe(
      "emitió la Factura A 0003-00022312 a TRANSPORTES SUR SA por $ 1.234.567,00",
    );
  });

  it("falls back to the payload when the invoice is gone", () => {
    const client = entity("client", "AGRO PAMPA");
    expect(
      auditSentence(
        "invoice.issue_requested",
        input(
          { kind: "nc", client_id: "c1", imp_total: 500 },
          { refs: { c1: client } },
        ),
      ),
    ).toBe("emitió la nota de crédito a AGRO PAMPA por $ 500,00");
  });

  it("names the receipt's client", () => {
    const subject = entity("receipt", "el Recibo 0001-00000045", {
      party: "AGRO PAMPA",
      amount: "$ 500.000,00",
    });
    expect(auditSentence("receipt.created", input({}, { subject }))).toBe(
      "registró el Recibo 0001-00000045 de AGRO PAMPA por $ 500.000,00",
    );
  });

  it("names the trip with its truck", () => {
    const subject = entity("trip", "el viaje del 07/11/2026 con AE463UF");
    expect(
      auditSentence(
        "trip.created",
        input({ trip_date: "2026-11-07" }, { subject }),
      ),
    ).toBe("programó el viaje del 07/11/2026 con AE463UF");
    expect(
      auditSentence("trip.created", input({ trip_date: "2026-11-07" })),
    ).toBe("programó un viaje del 07/11/2026");
  });

  it("reads settings changes as the owner says them", () => {
    expect(
      auditSentence(
        "late_interest.general_rate_set",
        input({ monthly_rate: 3 }),
      ),
    ).toBe("cambió la tasa general de intereses por mora a 3 % mensual");
    expect(
      auditSentence(
        "fleet_km.strix_credentials_saved",
        input({ usernameChanged: false, passwordChanged: true }),
      ),
    ).toBe("guardó el usuario de Strix (cambió la clave)");
    expect(
      auditSentence(
        "fleet_km.strix_sync_requested",
        input({ from: "2026-11-01", to: "2026-11-06" }),
      ),
    ).toBe("pidió traer km de Strix del 01/11/2026 al 06/11/2026");
  });

  it("names the fields an edit touched, in Spanish", () => {
    const subject = entity("client", "TRANSPORTES SUR SA");
    expect(
      auditSentence(
        "client.updated",
        input({ fields: ["legal_name", "cuit", "internal_flag"] }, { subject }),
      ),
    ).toBe(
      "editó el cliente TRANSPORTES SUR SA (razón social, CUIT y otros datos)",
    );
  });

  it("names the users of a role change", () => {
    expect(
      auditSentence(
        "user.roles.updated",
        input({ added: ["finance"], removed: [] }, { targetUser: "Ana Pérez" }),
      ),
    ).toBe("cambió los roles de Ana Pérez (le dio finanzas)");
  });

  it("humanizes an action the registry does not know", () => {
    expect(humanizeEventType("widget.created")).toBe("creó widget");
    expect(humanizeEventType("widget.spun")).toBe("hizo «widget · spun»");
    expect(auditSentence("widget.spun", input({ a: 1 }))).toBe(
      "hizo «widget · spun»",
    );
    expect(auditGroupOf("widget.spun")).toBeNull();
  });
});
