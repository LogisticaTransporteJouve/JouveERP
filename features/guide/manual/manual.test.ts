import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { NAV_SECTIONS } from "@/components/layout/nav-items";
import { PERMISSIONS } from "@/lib/auth/permissions";

import { ROUTE_GUIDES } from "../lib/route-guides";

import { GUIDE_PAGES } from "./content";
import { quotedLabels, quotedRefs } from "./markup";
import {
  indexAnchors,
  permissionsOf,
  routeMatches,
  screenLabels,
  sectionForPath,
  sectionScreens,
  sectionTexts,
} from "./model";
import type { GuideTask, MockScreen } from "./types";

// The guide quotes the app; these tests hold every quote to the code, so a
// renamed button, a moved route or a reworded error fails CI until the guide
// follows. See docs/decisions/2026-11-05-guia-de-uso.md.

const ROOT = path.resolve(__dirname, "../../..");

function walk(dir: string, keep: (file: string) => boolean): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full, keep));
    else if (keep(full)) out.push(full);
  }
  return out;
}

const normalize = (s: string) => s.replace(/\s+/g, " ");

const GUIDE_DIR = path.join(ROOT, "features/guide/manual");

/** The app's own source: what a user can read on screen comes from here. */
const SOURCE = normalize(
  ["app", "components", "features", "lib", "hooks"]
    .flatMap((d) =>
      walk(
        path.join(ROOT, d),
        (f) =>
          /\.tsx?$/.test(f) &&
          !/\.test\.tsx?$/.test(f) &&
          !f.startsWith(GUIDE_DIR) &&
          !f.endsWith("database.types.ts"),
      ),
    )
    .map((f) => readFileSync(f, "utf8"))
    .join("\n"),
);

/** Error messages also come from the database guards. */
const SOURCE_AND_SQL = `${SOURCE}\n${normalize(
  walk(path.join(ROOT, "supabase/migrations"), (f) => f.endsWith(".sql"))
    .map((f) => readFileSync(f, "utf8"))
    .join("\n"),
)}`;

/** Every page of the app as a route pattern: "/invoices/[id]". */
const APP_ROUTES = walk(path.join(ROOT, "app/(dashboard)"), (f) =>
  f.endsWith("page.tsx"),
)
  .map((f) => {
    const rel = path.relative(path.join(ROOT, "app/(dashboard)"), f);
    const segs = rel.split(path.sep).slice(0, -1);
    return `/${segs.filter((s) => !s.startsWith("(")).join("/")}`;
  })
  .sort();

/** Routes whose chapter is not written yet. Each domain PR removes its own;
 *  the list only shrinks (a covered route listed here fails). */
const PENDING_ROUTES: readonly string[] = [
  "/accounting/balance",
  "/accounting/chart",
  "/accounting/cost-centers",
  "/accounting/exchange-rates",
  "/accounting/inflation",
  "/accounting/journal",
  "/accounting/libro-iva-compras",
  "/accounting/libro-iva-ventas",
  "/accounting/libro-mayor",
  "/accounting/package",
  "/accounts",
  "/admin/afip/preview-pdf",
  "/admin/afip/puntos-de-venta",
  "/admin/audit",
  "/admin/backups",
  "/admin/imports",
  "/admin/padron",
  "/admin/users",
  "/aging",
  "/aging-suppliers",
  "/aging/mora",
  "/ai",
  "/ai/pinned",
  "/ai/tasks",
  "/cargas",
  "/chat",
  "/chat/[channelId]",
  "/checks",
  "/clients",
  "/clients/[id]",
  "/dashboard",
  "/documentos",
  "/drivers",
  "/employees",
  "/employees/[id]",
  "/files",
  "/fleet-documents",
  "/fleet-reports",
  "/fuel",
  "/hr/attendance",
  "/hr/attendance/[year]/[month]",
  "/hr/document-expirations",
  "/hr/payroll",
  "/hr/payroll/[year]/[month]",
  "/hr/payroll/sac/[year]/[half]",
  "/hr/vacations",
  "/invoices",
  "/invoices/[id]",
  "/issued-checks",
  "/liquidaciones",
  "/loans",
  "/loans/[id]",
  "/maintenance",
  "/management",
  "/pallets",
  "/pallets/trazabilidad",
  "/payment-orders",
  "/payment-orders/[id]",
  "/products",
  "/profile",
  "/purchases",
  "/purchases/[id]",
  "/purchases/arca",
  "/receipts",
  "/receipts/[id]",
  "/recurring-payments",
  "/rendiciones",
  "/storage-billing",
  "/storage-tariffs",
  "/suppliers",
  "/suppliers/[id]",
  "/suppliers/categories",
  "/tasks",
  "/taxes",
  "/transactions",
  "/treasury",
  "/treasury/cash-flow",
  "/treasury/reconciliation",
  "/trips",
  "/trips/[id]",
  "/vehicle-km",
  "/vehicles",
  "/warehouses",
];

const SECTIONS = GUIDE_PAGES.flatMap((p) => p.sections);
const TASKS: GuideTask[] = SECTIONS.flatMap((s) => s.tasks);
const TEXTS = SECTIONS.flatMap(sectionTexts).concat(
  GUIDE_PAGES.map((p) => p.lead),
);
const SCREENS: MockScreen[] = SECTIONS.flatMap(sectionScreens);

describe("guide structure", () => {
  it("has unique kebab-case ids for sections and tasks", () => {
    const ids = [...SECTIONS.map((s) => s.id), ...TASKS.map((t) => t.id)];
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(dupes).toEqual([]);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("names page files the app serves (lib/manual/serve.ts)", () => {
    const files = GUIDE_PAGES.map((p) => p.file);
    expect(new Set(files).size).toBe(files.length);
    for (const f of files) expect(f).toMatch(/^[a-z0-9][a-z0-9-]*\.html$/);
    expect(files).not.toContain("index.html");
  });

  it("links only to anchors that exist", () => {
    const anchors = indexAnchors(GUIDE_PAGES);
    const missing = [
      ...TEXTS.flatMap(quotedRefs).filter((r) => r.startsWith("#")),
      ...TASKS.flatMap((t) => (t.related ?? []).map((id) => `#${id}`)),
    ].filter((ref) => !anchors.has(ref.slice(1)));
    expect(missing).toEqual([]);
  });

  it("numbers each marker after a step the task has", () => {
    for (const task of TASKS) {
      const markers = (task.screens ?? []).flatMap(screenMarkers);
      for (const m of markers) {
        expect(m, task.id).toBeGreaterThanOrEqual(1);
        expect(m, task.id).toBeLessThanOrEqual(task.steps.length);
      }
    }
  });
});

function screenMarkers(s: MockScreen): number[] {
  const all: (number | undefined)[] = [];
  if (s.kind === "page") {
    s.actions?.forEach((b) => all.push(b.marker));
    s.toolbar?.forEach((f) => all.push(f.marker));
    all.push(s.tabs?.marker, s.table?.marker);
  } else if (s.kind === "dialog") {
    s.fields?.forEach((f) => all.push(f.marker));
    s.footer.forEach((b) => all.push(b.marker));
    all.push(s.table?.marker);
  } else {
    s.items.forEach((i) => all.push(i.marker));
  }
  return all.filter((m): m is number => m !== undefined);
}

describe("routes", () => {
  it("every route the guide names is a page of the app", () => {
    const named = [
      ...SECTIONS.flatMap((s) => s.routes),
      ...TEXTS.flatMap(quotedRefs).filter((r) => r.startsWith("/")),
    ];
    const unknown = named.filter(
      (r) => !APP_ROUTES.some((p) => p === r || routeMatches(p, r)),
    );
    expect(unknown).toEqual([]);
  });

  it("every page of the app has its section (or is pending)", () => {
    const covered = new Set(SECTIONS.flatMap((s) => s.routes));
    expect(
      APP_ROUTES.filter((r) => !covered.has(r) && !PENDING_ROUTES.includes(r)),
    ).toEqual([]);
    // A route written up comes off the pending list.
    expect(PENDING_ROUTES.filter((r) => covered.has(r))).toEqual([]);
    expect(PENDING_ROUTES.filter((r) => !APP_ROUTES.includes(r))).toEqual([]);
  });

  it("every menu entry and sidebar guide leads to a section (or is pending)", () => {
    const paths = [
      ...NAV_SECTIONS.flatMap((s) => s.items).map((i) => i.href),
      ...ROUTE_GUIDES.map((g) => g.prefix),
    ];
    const lost = paths.filter(
      (p) => !sectionForPath(GUIDE_PAGES, p) && !PENDING_ROUTES.includes(p),
    );
    expect(lost).toEqual([]);
  });
});

describe("quotes from the app", () => {
  it("every UI label the guide quotes exists in the code", () => {
    const labels = new Set([
      ...TEXTS.flatMap(quotedLabels),
      ...SCREENS.flatMap(screenLabels),
    ]);
    const missing = [...labels].filter((l) => !SOURCE.includes(normalize(l)));
    expect(missing).toEqual([]);
  });

  it("every error message the guide quotes exists in the code or the migrations", () => {
    const missing = TASKS.flatMap((t) => t.errors ?? [])
      .map((er) => er.message)
      .filter((msg) =>
        msg
          .split("…")
          .map((part) => normalize(part).trim())
          .filter(Boolean)
          .some((part) => !SOURCE_AND_SQL.includes(part)),
      );
    expect(missing).toEqual([]);
  });

  it("every permission it names is in the matrix", () => {
    const perms = [
      ...SECTIONS.flatMap((s) => permissionsOf(s.permission)),
      ...TASKS.flatMap((t) => permissionsOf(t.permission)),
    ];
    for (const p of perms) expect(PERMISSIONS).toContain(p);
  });
});
