import { APP_WINDOW } from "@/lib/manual/windows";

import { escapeHtml, toHtml, toPlainText, type RefResolver } from "./markup";
import {
  combine,
  makeResolver,
  permissionsOf,
  roleNames,
  taskRoleNames,
  stepText,
  taskTexts,
} from "./model";
import type {
  GuidePage,
  GuidePermission,
  GuideSection,
  GuideTask,
  MockButton,
  MockField,
  MockScreen,
  MockTable,
} from "./types";

// Renders the guide content to the static HTML under docs/manual/. Pure:
// the build test (build.test.ts) writes the result and CI fails when the
// committed files drift from it. No inline scripts or styles: the app serves
// these pages under a strict CSP (lib/manual/serve.ts).

const e = escapeHtml;

function label(text: string): string {
  return e(text.startsWith("~") ? text.slice(1) : text);
}

/** Validated labels carry data-ui so a reader (and a test) can tell them
 *  from sample text. */
function uiAttr(text: string): string {
  return text.startsWith("~") ? "" : ` data-ui="${e(text)}"`;
}

function marker(n: number | undefined): string {
  return n === undefined
    ? ""
    : `<span class="mk" aria-label="Paso ${n}">${n}</span>`;
}

function button(b: MockButton): string {
  const variant = b.variant ?? "outline";
  return `<span class="m-btn m-btn-${variant}"${uiAttr(b.label)}>${label(b.label)}${marker(b.marker)}</span>`;
}

function field(f: MockField): string {
  const kind = f.kind ?? "input";
  const value = f.value ? e(f.value) : "";
  let control: string;
  switch (kind) {
    case "checkbox":
    case "switch":
      control = `<span class="m-${kind}${f.value ? " on" : ""}"></span>`;
      return `<div class="m-field m-inline${f.wide ? " wide" : ""}">${control}<span class="m-label"${uiAttr(f.label)}>${label(f.label)}</span>${marker(f.marker)}</div>`;
    case "textarea":
      control = `<span class="m-input m-textarea">${value}</span>`;
      break;
    case "select":
    case "picker":
      control = `<span class="m-input m-select">${value}<span class="m-chevron">⌄</span></span>`;
      break;
    case "date":
      control = `<span class="m-input">${value || "Elegí fecha"}</span>`;
      break;
    case "money":
      control = `<span class="m-input m-money">${value || "0,00"}</span>`;
      break;
    default:
      control = `<span class="m-input">${value}</span>`;
  }
  return `<div class="m-field${f.wide ? " wide" : ""}"><span class="m-label"${uiAttr(f.label)}>${label(f.label)}</span>${control}${marker(f.marker)}</div>`;
}

function table(t: MockTable): string {
  const head = t.columns
    .map((c) => `<th${uiAttr(c)}>${label(c)}</th>`)
    .join("");
  const rows = t.rows
    .map(
      (r) =>
        `<tr>${r.map((c) => `<td>${e(c)}</td>`).join("")}${t.rowMenu ? `<td class="m-rowmenu">⋯</td>` : ""}</tr>`,
    )
    .join("");
  return `<div class="m-table">${marker(t.marker)}<table><thead><tr>${head}${t.rowMenu ? "<th></th>" : ""}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

export function renderScreen(s: MockScreen): string {
  const caption = s.caption ? `<figcaption>${e(s.caption)}</figcaption>` : "";
  if (s.kind === "page") {
    const actions = (s.actions ?? []).map(button).join("");
    const tabs = s.tabs
      ? `<div class="m-tabs">${s.tabs.labels
          .map(
            (l, i) =>
              `<span class="m-tab${i === (s.tabs?.active ?? 0) ? " active" : ""}"${uiAttr(l)}>${label(l)}</span>`,
          )
          .join("")}${marker(s.tabs.marker)}</div>`
      : "";
    const toolbar = s.toolbar?.length
      ? `<div class="m-toolbar">${s.toolbar.map(field).join("")}</div>`
      : "";
    const stats = s.stats?.length
      ? `<div class="m-stats">${s.stats
          .map(
            (st) =>
              `<div class="m-stat"><span${uiAttr(st.label)}>${label(st.label)}</span><strong>${e(st.value)}</strong></div>`,
          )
          .join("")}</div>`
      : "";
    return `<figure class="mock"><div class="m-frame m-page"><div class="m-head"><div><div class="m-title"${uiAttr(s.title)}>${label(s.title)}</div>${s.subtitle ? `<div class="m-sub">${e(s.subtitle)}</div>` : ""}</div><div class="m-actions">${actions}</div></div>${tabs}${toolbar}${stats}${s.table ? table(s.table) : ""}</div>${caption}</figure>`;
  }
  if (s.kind === "dialog") {
    const fields = s.fields?.length
      ? `<div class="m-form">${s.fields.map(field).join("")}</div>`
      : "";
    return `<figure class="mock"><div class="m-frame m-backdrop"><div class="m-dialog"><div class="m-dialog-title"${uiAttr(s.title)}>${label(s.title)}<span class="m-close">×</span></div>${s.description ? `<div class="m-sub">${e(s.description)}</div>` : ""}${fields}${s.table ? table(s.table) : ""}<div class="m-footer">${s.footer.map(button).join("")}</div></div></div>${caption}</figure>`;
  }
  const items = s.items
    .map(
      (i) =>
        `<span class="m-item${i.destructive ? " danger" : ""}"${uiAttr(i.label)}>${label(i.label)}${marker(i.marker)}</span>`,
    )
    .join("");
  const trigger = s.trigger
    ? `<span class="m-btn m-btn-ghost"${uiAttr(s.trigger)}>${label(s.trigger)}</span>`
    : "";
  return `<figure class="mock"><div class="m-frame m-menu-frame">${trigger}<div class="m-menu">${items}</div></div>${caption}</figure>`;
}

function whoCan(p: GuidePermission, roles = roleNames(p)): string {
  if (p === null) return "Cualquier usuario con sesión iniciada.";
  const perms = permissionsOf(p)
    .map((x) => `<code class="perm">${e(x)}</code>`)
    .join(typeof p === "object" && "anyOf" in p ? " o " : " + ");
  return `${e(roles)} <span class="muted">(permiso ${perms})</span>`;
}

/** "Además, según el registro:" one line per record with its own roles. */
function perRecord(task: GuideTask): string {
  if (!task.permissionByRecord?.length) return "";
  const rows = task.permissionByRecord
    .map(
      (r) =>
        `<li>${e(r.record)}: ${e(roleNames(combine(task.permission, r.permission)))} <span class="muted">(${permissionsOf(
          r.permission,
        )
          .map((x) => `<code class="perm">${e(x)}</code>`)
          .join(" + ")})</span></li>`,
    )
    .join("");
  return `<div class="muted">Además, el permiso de escritura del registro:</div><ul>${rows}</ul>`;
}

function list(items: readonly string[] | undefined, r: RefResolver): string {
  if (!items?.length) return "";
  return `<ul>${items.map((i) => `<li>${toHtml(i, r)}</li>`).join("")}</ul>`;
}

function renderTask(task: GuideTask, r: RefResolver): string {
  const steps = task.steps
    .map((s) => {
      const sub =
        typeof s === "string" || !s.substeps?.length
          ? ""
          : `<ul>${s.substeps.map((x) => `<li>${toHtml(x, r)}</li>`).join("")}</ul>`;
      return `<li>${toHtml(stepText(s), r)}${sub}</li>`;
    })
    .join("");
  const errors = task.errors?.length
    ? `<div class="block errors"><h4>Si aparece un error</h4><dl>${task.errors
        .map((er) => `<dt>“${e(er.message)}”</dt><dd>${toHtml(er.fix, r)}</dd>`)
        .join("")}</dl></div>`
    : "";
  const related = task.related?.length
    ? `<p class="related">Relacionado: ${task.related
        .map((id) => toHtml(`[[#${id}]]`, r))
        .join(" · ")}</p>`
    : "";
  return `<article class="task" id="${e(task.id)}">
<h3><a class="anchor" href="#${e(task.id)}">${e(task.title)}</a></h3>
${task.summary ? `<p>${toHtml(task.summary, r)}</p>` : ""}
<dl class="meta"><dt>Quién puede</dt><dd>${whoCan(task.permission, taskRoleNames(task))}${perRecord(task)}</dd>${
    task.prerequisites?.length
      ? `<dt>Antes</dt><dd>${list(task.prerequisites, r)}</dd>`
      : ""
  }</dl>
${(task.screens ?? []).map(renderScreen).join("\n")}
<ol class="steps">${steps}</ol>
${task.after?.length ? `<div class="block after"><h4>Qué pasa después</h4>${list(task.after, r)}</div>` : ""}
${errors}
${related}
</article>`;
}

function renderSection(section: GuideSection, r: RefResolver): string {
  const where = section.menuPath
    ? `<p class="where">En el menú: <strong>${e(section.menuPath)}</strong>${
        section.routes.length
          ? ` · <code>${section.routes.map(e).join("</code>, <code>")}</code>`
          : ""
      }</p>`
    : "";
  // A screen with no route parameter can be opened from the guide, in the
  // app's own tab (the guide stays open next to it).
  const openable = section.routes.find((route) => !route.includes("["));
  const open = openable
    ? `<p class="open"><a href="${e(openable)}" target="${APP_WINDOW}">Abrir esta pantalla en JouveERP ↗</a></p>`
    : "";
  const who =
    section.routes.length > 0
      ? `<p class="where">Ven esta pantalla: ${whoCan(section.permission)}</p>`
      : "";
  const concepts = (section.concepts ?? [])
    .map(
      (c) =>
        `<div class="concept"><h4>${e(c.title)}</h4>${c.body.map((b) => `<p>${toHtml(b, r)}</p>`).join("")}</div>`,
    )
    .join("");
  const toc = section.tasks.length
    ? `<ul class="task-toc">${section.tasks.map((t) => `<li><a href="#${e(t.id)}">${e(t.title)}</a></li>`).join("")}</ul>`
    : "";
  return `<section class="section" id="${e(section.id)}">
<h2><a class="anchor" href="#${e(section.id)}">${e(section.title)}</a></h2>
${where}${who}${open}
${section.intro.map((p) => `<p>${toHtml(p, r)}</p>`).join("")}
${(section.screens ?? []).map(renderScreen).join("\n")}
${concepts}
${toc}
${section.tasks.map((t) => renderTask(t, r)).join("\n")}
</section>`;
}

function sidebar(pages: readonly GuidePage[], current: string): string {
  const nav = pages
    .map((p) => {
      const active = p.file === current;
      const sections = active
        ? `<ul>${p.sections.map((s) => `<li><a href="${e(p.file)}#${e(s.id)}">${e(s.title)}</a></li>`).join("")}</ul>`
        : "";
      return `<li${active ? ' class="active"' : ""}><a href="${e(p.file)}">${e(p.title)}</a>${sections}</li>`;
    })
    .join("");
  return `<aside class="sidebar">
<a class="brand" href="index.html"><span class="logo">J</span><span>Guía de JouveERP</span></a>
<div class="search"><input id="guide-search" type="search" placeholder="Buscar: emitir factura, cheque…" autocomplete="off" aria-label="Buscar en la guía" /><div id="guide-results" class="results" hidden></div></div>
<nav><ul class="nav">${nav}</ul></nav>
</aside>`;
}

function shell(
  pages: readonly GuidePage[],
  current: string,
  title: string,
  body: string,
): string {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${e(title)} — Guía JouveERP</title>
<link rel="stylesheet" href="assets/styles.css" />
</head>
<body>
<div class="layout">
${sidebar(pages, current)}
<div class="content">
<header class="topbar"><a href="index.html">Guía</a><span class="sep">›</span><strong>${e(title)}</strong><a class="back" href="/dashboard" target="${APP_WINDOW}">Volver a JouveERP</a></header>
<main>
${body}
</main>
</div>
</div>
<script src="assets/search-index.js"></script>
<script src="assets/guide.js"></script>
</body>
</html>
`;
}

export function renderPage(
  pages: readonly GuidePage[],
  page: GuidePage,
): string {
  const r = makeResolver(pages);
  const toc = `<nav class="toc"><h4>En esta página</h4><ul>${page.sections
    .map((s) => `<li><a href="#${e(s.id)}">${e(s.title)}</a></li>`)
    .join("")}</ul></nav>`;
  const body = `<h1>${e(page.title)}</h1>
<p class="lead">${toHtml(page.lead, r)}</p>
${toc}
${page.sections.map((s) => renderSection(s, r)).join("\n")}`;
  return shell(pages, page.file, page.title, body);
}

export function renderIndex(pages: readonly GuidePage[]): string {
  const r = makeResolver(pages);
  const tasks = pages.reduce(
    (n, p) => n + p.sections.reduce((m, s) => m + s.tasks.length, 0),
    0,
  );
  const cards = pages
    .map(
      (p) =>
        `<a class="card" href="${e(p.file)}"><strong>${e(p.title)}</strong><span>${e(toPlainText(p.lead, r))}</span><span class="muted">${p.sections.length} secciones · ${p.sections.reduce((m, s) => m + s.tasks.length, 0)} tareas</span></a>`,
    )
    .join("");
  const body = `<h1>Guía de JouveERP</h1>
<p class="lead">Cómo se hace cada cosa en el sistema, pantalla por pantalla: quién puede hacerla, los pasos con los nombres exactos de los botones, qué pasa después y qué hacer si aparece un error. ${tasks} tareas en ${pages.length} capítulos.</p>
<div class="howto">
<p><strong>Cómo usarla.</strong> Buscá arriba a la izquierda lo que querés hacer («emitir factura», «depositar cheque»). En cada pantalla del sistema, el botón <strong>?</strong> del encabezado abre su sección. También podés preguntarle al asistente («¿cómo hago una nota de crédito?»): responde con estos mismos pasos.</p>
<p>Los nombres <span class="ui">así</span> son textos tal cual aparecen en pantalla. Los números <span class="mk mk-inline">1</span> en los dibujos de pantalla marcan dónde va cada paso.</p>
</div>
<div class="cards">${cards}</div>`;
  return shell(pages, "index.html", "Inicio", body);
}

export type SearchEntry = {
  /** "ventas.html#emitir-factura" */
  href: string;
  title: string;
  /** Where it lives: "Ventas › Comprobantes". */
  path: string;
  text: string;
};

export function searchEntries(pages: readonly GuidePage[]): SearchEntry[] {
  const r = makeResolver(pages);
  const out: SearchEntry[] = [];
  for (const page of pages) {
    for (const section of page.sections) {
      out.push({
        href: `${page.file}#${section.id}`,
        title: section.title,
        path: page.title,
        text: section.intro.map((t) => toPlainText(t, r)).join(" "),
      });
      for (const task of section.tasks) {
        out.push({
          href: `${page.file}#${task.id}`,
          title: task.title,
          path: section.menuPath ?? `${page.title} › ${section.title}`,
          text: [...taskTexts(task), ...(task.keywords ?? [])]
            .map((t) => toPlainText(t, r))
            .join(" "),
        });
      }
    }
  }
  return out;
}

export function renderSearchIndex(pages: readonly GuidePage[]): string {
  return `// Generated by \`pnpm manual:build\` from features/guide/manual/content. Do not edit.
window.GUIDE_INDEX = ${JSON.stringify(searchEntries(pages), null, 0)};
`;
}
