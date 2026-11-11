---
name: mock-ui
description: >-
  Build an interactive mock of JouveERP screens — an exact copy of today's app plus what a feature
  adds, marked with a dashed blue outline — as one HTML file published as a shareable Artifact. Use
  for "mock", "mockup", "prototype", "maqueta", "maqueta para mostrar", "mostrame cómo quedaría X en
  JouveERP", "clickable prototype of X", or when iterating on a mock built with this skill.
---

# JouveERP mocks

A mock is today's JouveERP, pixel for pixel, plus the proposal. Nothing visual is drawn by hand:

- **Shell** (sidebar, header with breadcrumb, search and bell, the canvas card, the phone tab bar): the
  real `AppSidebar` (`components/layout/app-sidebar.tsx`), `AppHeader`
  (`components/layout/app-header.tsx`), `SidebarInset` and `MobileTabBar`, inside `ScopeProvider` and
  `SidebarProvider`, as `app/(dashboard)/layout.tsx` mounts them. Bundled from the repo and mounted
  with React: it collapses, switches theme, shows only the nav the mock user's roles can see, and
  marks the active route and breadcrumb from `components/layout/nav-items.ts`.
- **Primitives** (`ui.*`): every class comes from the real `components/ui/*`, read at build time
  from a server-rendered catalog and the real `buttonVariants` / `badgeVariants`, merged with the
  app's own `cn()` (`lib/utils.ts`). Icons come from the repo's own `lucide-react`.
- **CSS**: `app/globals.css` compiled with the repo's Tailwind v4 (`@tailwindcss/postcss`). Same
  tokens (neutral oklch + the índigo Jouve `primary`), dark mode and animations as the app.
- **Toasts**: the app's sonner `Toaster`.

You write only the canvas content (`app.js`) and a config (`mock.json`). The build reads the repo, so a
mock rebuilt next month picks up next month's UI.

## Where things live

- Kit: `.agents/skills/mock-ui/kit/` — `build.mjs`, `runtime.js` (the `Mock` / `ui` API),
  `shell.tsx`, `catalog.tsx`, `theme-boot.js`, `mock.css`, `stubs/`. It sits under `.agents/`, which
  `tsconfig.json` and `eslint.config.mjs` exclude: it is never part of `pnpm typecheck`, `pnpm lint`
  or `pnpm build`, and the app never imports it.
- Example to copy from: `.agents/skills/mock-ui/example/` (Liquidaciones with a new "Cobro" column
  and a pending-collection tile).
- Mocks: never in the repo or a worktree (both get wiped or committed). Use the session scratchpad
  when the system prompt lists one, `<scratchpad>/mocks/<slug>/`; otherwise
  `~/.cache/jouve-plans/mocks/<slug>/`. Each holds `mock.json` + `app.js`. Say the path in the reply:
  a scratchpad dies with its session.

## Workflow

### 1. Pin down the screens

Name each screen the mock shows and which part is new. Ask the user only what the code cannot answer
(which flow, which states matter, who sees it: the team or a client).

### 2. Read today's UI before drawing it

For every screen that exists today, open its route in `app/(dashboard)/<route>/page.tsx` and the
feature component it renders under `features/<domain>/components/`, and reproduce what it renders:

- Layout, spacing and typography: copy the JSX `className` strings as they are (the page header is
  usually `<h1 class="text-2xl font-semibold tracking-tight">` plus a muted `<p>`; lists sit in
  `DataTable`'s `rounded-lg border bg-card` wrapper; list filters follow `components/list-toolbar.tsx`).
- Primitives: `ui.*` helpers, never hand-written equivalents.
- Feature-specific labels and states: copy from the feature's schema or lib — e.g.
  `CHECK_STATUS_LABEL` in `features/checks/schema.ts`. Money as the app
  formats it (`formatMoney` in `lib/format.ts`: `$ 1.234,56`), dates as `formatArgentineDate` (`dd/mm/aaaa`).
- Wording: the app's own Spanish (Argentina) labels, capitalization and empty states.
- Navigation: `nav` is the route in `nav-items.ts`; the header's breadcrumb (section › item) follows
  it on its own.
- CRUD lives in a centered `Dialog` (`ui.dialog`), not a sheet, as in `CLAUDE.md`.

If a local app is already running (`curl -s -o /dev/null -w "%{http_code}" http://localhost:3000`),
open the real page in the browser and compare side by side. Never start one for this. If none is
running and the screen matters, ask the user for a screenshot rather than guessing.

### 3. Write `mock.json` and `app.js`

Copy the example and edit. Rules:

- **New things go in `ui.isNew(html)`**: dashed blue outline. Everything outside it must already
  exist in the app. The toolbar's "Nuevo" button hides the marks; `"client": true` starts with them
  hidden for a client-facing version.
- **No CSS of your own.** No `<style>`, no `style=` colours, no invented palette. Tailwind classes only,
  preferably copied from a component. One colour, as in the app: `primary` (índigo Jouve) on primary
  buttons, active nav and focus; danger is copy and icons, not colour.
- **UI as simple as the app's:** no helper sentences, subtitles or explanatory counts the real screen
  would not have. Explanations go in `intro` / `steps`, which show in the mock's help panel, not in
  JouveERP's UI.
- **Content in Spanish (Argentina)** with realistic data: Argentine company names (S.A., S.R.L.),
  CUITs in the `30-12345678-9` shape, pesos with `$ 1.234,56`, remitos and comprobantes numbered like
  the app (`R-00000012`, `A 0003-00001042`). All made up: never a real client, CUIT or voucher.
- Every click a step needs must work. Anything else falls through to a "No es parte de esta maqueta"
  toast — never a dead button that does nothing.

### 4. Build and check

```bash
node .agents/skills/mock-ui/kit/build.mjs <mock folder>
```

Run it from a JouveERP checkout. It finds the repo from `--repo <path>`, `$JOUVE_REPO`, the current
git checkout, or the checkout the kit sits in. It needs `pnpm install` done in that repo (it uses the
repo's own esbuild, postcss and `@tailwindcss/postcss` from `node_modules/.pnpm`); no running stack,
no network. Output: `<slug>.html`, about 1.3 MB.

Open it in a browser (`file://` works; or `python3 -m http.server <free port> --bind 127.0.0.1` from
the mock folder, in the background):

- Run every `steps` entry through the UI, then the same in dark mode (toolbar theme button) and at
  phone width.
- Read the console for errors.
- Without a browser pane, drive it with Playwright from the repo and the system Chrome
  (`chromium.launch({ channel: "chrome" })`) and look at the screenshots.

### 5. Publish

Publish the built HTML with the Artifact tool (`file_path` = the `.html`, `icon: "layout"`, a
one-sentence `description`). Republishing the same path keeps the link. Artifacts start private: say
that others open it only after the user shares it from the page's Share menu.

Iterate: edit `app.js` → rebuild → republish the same file.

## `mock.json`

```json
{
  "title": "Cobro en Liquidaciones",
  "slug": "liquidaciones-cobro",
  "user": { "firstName": "Marta", "lastName": "Giménez", "email": "marta@jouve.test", "avatarColor": "blue" },
  "roles": ["finance"],
  "denied": [],
  "scope": "fiscal",
  "activePath": "/liquidaciones",
  "intro": "One or two sentences for the help panel.",
  "steps": ["What to click first", "What to try next"],
  "client": false
}
```

`roles` are roles from `lib/auth/permissions.ts` (default `owner`) and `denied` per-user denied
permissions; the shell builds the user's access with `resolveAccess`, so the sidebar and tab bar
show exactly what that user would see. `scope` is the side the menu starts on: `fiscal` (Ventas /
Compras) or `internal` (Otras ventas / compras); a `fiscal_reader` is pinned to fiscal, as in the app.

## `app.js`

```js
Mock.app({
  state: { /* plain JSON; Restart resets to it */ },
  view: function (s) { return "<canvas html>"; },          // inside the canvas card, under the header
  overlay: function (s) { return s.overlay ? ui.dialog({...}) : ""; }, // dialogs and sheets
  page: function (s) { return { nav: "/liquidaciones" }; }, // the active route: nav item + breadcrumb
  actions: {
    // data-action="name" (with data-arg) → actions.name(state, arg, el, event), then re-render
    // data-input="name" on an input → actions.name(state, value)
    // nav(state, target): a sidebar, header or tab-bar link — the route it points to ("/invoices")
    // close(state): dialog X, backdrop, Escape — defaults to state.overlay = null
  },
});
```

`Mock.toast(text)` shows the app's toast. Inputs that keep focus across re-renders need an `id`. Every
action re-renders the view, so give each scroll area `data-scroll="<id>"` to keep its position, and a
chat's transcript `data-scroll-end="<message count>"` to follow new messages to the bottom.

The shell's own data (chat unread count, the sidebar guide's checklist, notifications) comes from
server actions, which the build replaces with stubs that answer `{ ok: false }`: those pieces show
their empty state. The global search dialog does not open.

### `ui` helpers

Options objects are optional; `cls` appends classes (merged with `cn`, so a later class wins),
`action` / `arg` wire a click, `attrs` adds attributes.

| Helper | Renders |
| --- | --- |
| `ui.button(label, { variant, size, icon, iconRight })` | `<Button>`; variant `default·destructive·outline·secondary·ghost·link`, size `default·xs·sm·lg·icon·icon-xs·icon-sm·icon-lg` |
| `ui.badge(label, { variant, icon })` | `<Badge>`; variant `default·secondary·destructive·outline·ghost·link` |
| `ui.input({ id, value, placeholder, input })`, `ui.textarea(...)`, `ui.label(text, { for })` | form fields |
| `ui.checkbox(checked, { action })`, `ui.switch(checked, { action, size })` | Radix checkbox / switch markup |
| `ui.select(value, { placeholder, open, action })` + `ui.selectContent(options, selected, { action })` | select trigger and list |
| `ui.menu(items)` | dropdown menu; items `{ label, icon, action, arg, shortcut, checked, destructive }`, `"separator"`, `{ heading }` |
| `ui.anchor(trigger, popup, { close, align: "end", block })` | shows `popup` (menu, select list, popover) under `trigger` in a fixed layer like Radix's portal; `close` runs on outside click and Escape |
| `ui.popover(html)`, `ui.tooltip(trigger, text)` | popover content; hover tooltip |
| `ui.dialog({ title, description, body, footer, close })`, `ui.sheet(...)` | from `overlay()` only |
| `ui.table(head, rows)`, `ui.tr(cells, { action, selected })`, `ui.td(html, cls)`, `ui.th(h)` | `<Table>` parts |
| `ui.tabs(items, active, { action })` | tabs list; items `{ value, label, icon }` |
| `ui.card({ title, description, action, content, footer })` | `<Card>` |
| `ui.stats([{ label, value, note }])` | `<StatGrid>` of `<StatTile>`s (`components/ui/stat-tile.tsx`) |
| `ui.section({ title, description, actions, body })` | `<Section>` (`components/ui/section.tsx`) |
| `ui.avatar`, `ui.skeleton`, `ui.separator`, `ui.spinner` | the matching primitive; the spinner is the app's `Loader2` + `animate-spin` |
| `ui.icon(name, cls)` | lucide icon by kebab name (`"receipt"`, `"more-horizontal"`) |
| `ui.isNew(html, { inline, inset })` | the blue "new" mark; `inline` for inline content, `inset` keeps it inside a whole panel's edge |
| `ui.esc(text)`, `ui.cx(...)` | escape user text; the app's `cn()` |

A primitive missing here: read its file in `components/ui/`, add it to `catalog.tsx` (so the build
captures its `data-slot` classes into `KIT.slots`, or a whole piece into `KIT.templates`) and a helper
to `runtime.js` that uses them.

## When the build breaks

- `catalog part "…" not found`: a `components/ui` component changed its markup. Update the matching
  regex or the `REQUIRED` list in `build.mjs`, or the piece in `catalog.tsx`.
- An esbuild error naming an import: the shell now imports something browser-hostile (a Next server
  API, a server-only module, Sentry). Add a stub in `kit/stubs/` and map it in `STUBS` in `build.mjs`.
  A `"use server"` module is stubbed on its own.
- A shell component changed its props (`AppSidebar`, `AppHeader`, `MobileTabBar`, `ScopeProvider`):
  mirror `app/(dashboard)/layout.tsx` again in `shell.tsx`.
- An icon renders as nothing: its name is not a `lucide-react` icon (check
  `node_modules/lucide-react/dist/esm/icons/<name>.mjs`), or it is built at runtime from parts; write
  the full name as a string literal somewhere in `app.js` so the build bundles it.
- `JouveERP checkout not found`: pass `--repo`.
