import {
  ROLE_LABELS,
  rolesGranting,
} from "@/features/admin-users/lib/role-labels";
import {
  userCan,
  type Access,
  type Permission,
  type Role,
} from "@/lib/auth/permissions";

import type { RefResolver } from "./markup";
import type {
  GuidePage,
  GuidePermission,
  GuideSection,
  GuideStep,
  GuideTask,
  GuideText,
  MockScreen,
} from "./types";

// Lookups over the guide content: anchors, route patterns, who can do a task.

export type Anchor =
  | { kind: "section"; page: GuidePage; section: GuideSection }
  | {
      kind: "task";
      page: GuidePage;
      section: GuideSection;
      task: GuideTask;
    };

export function anchorHref(a: Anchor): string {
  const id = a.kind === "task" ? a.task.id : a.section.id;
  return `${a.page.file}#${id}`;
}

export function anchorTitle(a: Anchor): string {
  return a.kind === "task" ? a.task.title : a.section.title;
}

/** Every section and task by id. Ids are unique across the guide
 *  (manual.test.ts); a duplicate keeps the first. */
export function indexAnchors(pages: readonly GuidePage[]): Map<string, Anchor> {
  const map = new Map<string, Anchor>();
  for (const page of pages) {
    for (const section of page.sections) {
      if (!map.has(section.id))
        map.set(section.id, { kind: "section", page, section });
      for (const task of section.tasks) {
        if (!map.has(task.id))
          map.set(task.id, { kind: "task", page, section, task });
      }
    }
  }
  return map;
}

/** "/invoices/[id]" matches "/invoices/42" (one segment per bracket). */
export function routeMatches(pattern: string, pathname: string): boolean {
  const p = pattern.split("/").filter(Boolean);
  const s = pathname.split("/").filter(Boolean);
  if (p.length !== s.length) return false;
  return p.every((seg, i) => seg.startsWith("[") || seg === s[i]);
}

/** The section documenting a route pattern ("/invoices/[id]") or a concrete
 *  path ("/invoices/42"): the exact match, else the deepest ancestor. */
export function sectionForPath(
  pages: readonly GuidePage[],
  pathname: string,
): Anchor | undefined {
  const clean = (pathname.split(/[?#]/)[0] ?? "").replace(/\/+$/, "") || "/";
  let best: { anchor: Anchor; depth: number } | undefined;
  for (const page of pages) {
    for (const section of page.sections) {
      for (const route of section.routes) {
        const exact = route === clean || routeMatches(route, clean);
        const ancestor = clean.startsWith(`${route}/`);
        if (!exact && !ancestor) continue;
        const depth = exact ? Number.MAX_SAFE_INTEGER : route.length;
        if (!best || depth > best.depth) {
          best = { anchor: { kind: "section", page, section }, depth };
        }
      }
    }
  }
  return best?.anchor;
}

export function makeResolver(pages: readonly GuidePage[]): RefResolver {
  const anchors = indexAnchors(pages);
  return (target) => {
    if (target.startsWith("#")) {
      const a = anchors.get(target.slice(1));
      if (!a) return { href: target, text: target.slice(1) };
      return { href: anchorHref(a), text: anchorTitle(a) };
    }
    const a = sectionForPath(pages, target);
    if (!a) return { href: "index.html", text: target };
    return { href: anchorHref(a), text: a.section.menuPath ?? a.section.title };
  };
}

function permissionList(p: GuidePermission): {
  all: readonly Permission[];
  any: readonly Permission[];
} {
  if (p === null) return { all: [], any: [] };
  if (typeof p === "string") return { all: [p], any: [] };
  if ("anyOf" in p) return { all: [], any: p.anyOf };
  return { all: p, any: [] };
}

export function permissionsOf(p: GuidePermission): Permission[] {
  const { all, any } = permissionList(p);
  return [...all, ...any];
}

function passes(has: (perm: Permission) => boolean, p: GuidePermission) {
  const { all, any } = permissionList(p);
  return all.every(has) && (any.length === 0 || any.some(has));
}

/** Whether an access passes a guide permission (roles and per-user denies). */
export function accessCan(access: Access, p: GuidePermission): boolean {
  return passes((perm) => userCan(access, perm), p);
}

/** The roles whose matrix passes the permission (before per-user denies). */
export function rolesFor(p: GuidePermission): Role[] {
  return rolesGranting((has) => passes(has, p));
}

/** "Owner, Admin, Finanzas" — the role names as /admin/users shows them. */
export function roleNames(p: GuidePermission): string {
  return rolesFor(p)
    .map((r) => ROLE_LABELS[r])
    .join(", ");
}

export function stepText(step: GuideStep): GuideText {
  return typeof step === "string" ? step : step.text;
}

/** The label strings a replica shows (sample ones, "~…", excluded). */
export function screenLabels(screen: MockScreen): string[] {
  const out: string[] = [];
  if (screen.kind === "page") {
    out.push(screen.title);
    screen.actions?.forEach((b) => out.push(b.label));
    screen.tabs?.labels.forEach((l) => out.push(l));
    screen.toolbar?.forEach((f) => out.push(f.label));
    screen.stats?.forEach((s) => out.push(s.label));
    screen.table?.columns.forEach((c) => out.push(c));
  } else if (screen.kind === "dialog") {
    out.push(screen.title);
    screen.fields?.forEach((f) => out.push(f.label));
    screen.table?.columns.forEach((c) => out.push(c));
    screen.footer.forEach((b) => out.push(b.label));
  } else {
    if (screen.trigger) out.push(screen.trigger);
    screen.items.forEach((i) => out.push(i.label));
  }
  return out.filter((l) => l !== "" && !l.startsWith("~") && l !== "⋯");
}

/** Every GuideText of a section, its tasks included. */
export function sectionTexts(section: GuideSection): GuideText[] {
  const out: GuideText[] = [...section.intro];
  for (const c of section.concepts ?? []) out.push(c.title, ...c.body);
  for (const t of section.tasks) out.push(...taskTexts(t));
  return out;
}

export function taskTexts(task: GuideTask): GuideText[] {
  const out: GuideText[] = [task.title];
  if (task.summary) out.push(task.summary);
  out.push(...(task.prerequisites ?? []));
  for (const s of task.steps) {
    out.push(stepText(s));
    if (typeof s !== "string") out.push(...(s.substeps ?? []));
  }
  out.push(...(task.after ?? []));
  for (const e of task.errors ?? []) out.push(e.fix);
  return out;
}

export function sectionScreens(section: GuideSection): MockScreen[] {
  return [
    ...(section.screens ?? []),
    ...section.tasks.flatMap((t) => t.screens ?? []),
  ];
}

/** Where the app serves the guide section of a screen; the guide's home when
 *  no section documents it. */
export function guideHrefForPath(
  pages: readonly GuidePage[],
  pathname: string,
): string {
  const anchor = pathname.startsWith("/")
    ? sectionForPath(pages, pathname)
    : undefined;
  return `/manual/${anchor ? anchorHref(anchor) : "index.html"}`;
}
