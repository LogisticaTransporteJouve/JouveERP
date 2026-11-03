#!/usr/bin/env node
// Builds a JouveERP mock into one self-contained HTML file.
//
//   node .agents/skills/mock-ui/kit/build.mjs <mockDir> [--repo <path>]
//
// <mockDir> holds mock.json (shell config) and app.js (the views). Everything visual
// comes from the JouveERP checkout at build time: the real dashboard shell (AppSidebar,
// AppHeader, SidebarInset, MobileTabBar) is bundled and mounted with React, components/ui
// classes are read from a server-rendered catalog, and the CSS is app/globals.css compiled
// with the repo's own Tailwind v4. Output: <mockDir>/<slug>.html.
//
// The kit lives under .agents/, which tsconfig.json and eslint.config.mjs exclude: it is
// never part of `pnpm typecheck`, `pnpm lint` or `pnpm build`.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";

const KIT = path.dirname(new URL(import.meta.url).pathname);
const args = process.argv.slice(2);
const repoAt = args.indexOf("--repo");
const repoFlag = repoAt >= 0 ? args[repoAt + 1] : null;
const mockDir = path.resolve(args.find((a, i) => !a.startsWith("--") && (repoAt < 0 || i !== repoAt + 1)) ?? ".");

const isRepo = (dir) => dir && fs.existsSync(path.join(dir, "app/globals.css")) && fs.existsSync(path.join(dir, "components/layout/app-sidebar.tsx"));
const findRepo = () => {
  const candidates = [repoFlag, process.env.JOUVE_REPO];
  try {
    candidates.push(execSync("git rev-parse --show-toplevel", { cwd: process.cwd(), stdio: ["ignore", "pipe", "ignore"] }).toString().trim());
  } catch {}
  // The checkout this kit sits in: .agents/skills/mock-ui/kit → repo root.
  candidates.push(path.resolve(KIT, "../../../.."));
  const repo = candidates.find(isRepo);
  if (!repo) throw new Error("JouveERP checkout not found: pass --repo <path> or set JOUVE_REPO");
  return path.resolve(repo);
};

const REPO = findRepo();
const PNPM = path.join(REPO, "node_modules/.pnpm");
if (!fs.existsSync(PNPM)) throw new Error(`${REPO} has no node_modules — run pnpm install there`);

// The repo's own build tools, newest installed version of each.
const fromPnpm = (prefix, sub) => {
  const dirs = fs.readdirSync(PNPM).filter((d) => d.startsWith(prefix + "@")).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!dirs.length) throw new Error(`${prefix} not installed in ${REPO} — run pnpm install`);
  return createRequire(path.join(PNPM, dirs.at(-1), "node_modules", "_"))(sub);
};
const esbuild = fromPnpm("esbuild", "esbuild");
const postcss = fromPnpm("postcss", "postcss");
const tailwind = fromPnpm("@tailwindcss+postcss", "@tailwindcss/postcss");

const config = JSON.parse(fs.readFileSync(path.join(mockDir, "mock.json"), "utf8"));
const appJs = fs.readFileSync(path.join(mockDir, "app.js"), "utf8");
const slug = config.slug ?? path.basename(mockDir);
const tmp = path.join(mockDir, ".build");
fs.mkdirSync(tmp, { recursive: true });

// ---------- 1. bundle the real shell for the browser; server-render the ui catalog ----------
const STUBS = {
  "next/link": "stubs/next-link.tsx",
  "next/navigation": "stubs/next-navigation.ts",
  "next/image": "stubs/next-image.tsx",
  "next/dynamic": "stubs/next-dynamic.tsx",
  "next-themes": "stubs/next-themes.ts",
  "@/lib/supabase/client": "stubs/supabase.ts",
  "@/lib/supabase/server": "stubs/supabase.ts",
  "next/headers": "stubs/empty.ts",
  "next/cache": "stubs/empty.ts",
  "server-only": "stubs/empty.ts",
  "@sentry/nextjs": "stubs/noop.ts",
  "@radix-ui/react-portal": "stubs/radix-portal.tsx",
};
// A "use server" module (features/*/actions) never reaches the browser: each export becomes
// an action that answers { ok: false }, so the shell's queries (chat unread, guide,
// notifications) settle empty instead of pulling the server code into the bundle.
const USE_SERVER = /^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*["']use server["']/;
const serverActions = {
  name: "server-actions",
  setup(b) {
    b.onLoad({ filter: /\.tsx?$/ }, (a) => {
      if (a.path.includes(`${path.sep}node_modules${path.sep}`)) return undefined;
      const src = fs.readFileSync(a.path, "utf8");
      if (!USE_SERVER.test(src)) return undefined;
      const names = new Set([...src.matchAll(/export\s+(?:async\s+)?(?:function\s*\*?|const|let)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]));
      const body = [...names].map((n) => `export const ${n} = mockAction;`).join("\n");
      return { contents: `const mockAction = async () => ({ ok: false, error: "No es parte de esta maqueta." });\n${body}\n`, loader: "js" };
    });
  },
};
// Icons: every kebab-case string in app.js and runtime.js that names a lucide-react icon is
// bundled from the repo's own lucide-react (the version the app renders), as "mock-icons".
const ICON_DIR = path.join(REPO, "node_modules/lucide-react/dist/esm/icons");
const runtimeJs = fs.readFileSync(path.join(KIT, "runtime.js"), "utf8");
// An alias (circle-help) only re-exports its canonical icon (circle-question-mark): follow it.
const iconFile = (name, hops = 0) => {
  const file = path.join(ICON_DIR, `${name}.mjs`);
  if (!fs.existsSync(file)) return null;
  const src = fs.readFileSync(file, "utf8");
  if (src.includes("__iconData")) return file;
  const target = src.match(/from '\.\/([\w-]+)\.mjs'/)?.[1];
  return target && hops < 3 ? iconFile(target, hops + 1) : null;
};
const icons = [...new Set([...(appJs + runtimeJs).matchAll(/["']([a-z][a-z0-9]*(?:-[a-z0-9]+)*)["']/g)].map((m) => m[1]))]
  .map((name) => ({ name, file: iconFile(name) }))
  .filter((i) => i.file);
const mockIcons = {
  name: "mock-icons",
  setup(b) {
    b.onResolve({ filter: /^mock-icons$/ }, () => ({ path: "mock-icons", namespace: "mock-icons" }));
    b.onLoad({ filter: /.*/, namespace: "mock-icons" }, () => ({
      contents: icons.map((ic, i) => `import { __iconData as i${i} } from ${JSON.stringify(ic.file)};`).join("\n") +
        `\nexport const ICONS = {${icons.map((ic, i) => `${JSON.stringify(ic.name)}: i${i}.node`).join(", ")}};\n`,
      resolveDir: REPO, loader: "js",
    }));
  },
};
const bundle = (entry, platform, rest) => esbuild.build({
  entryPoints: [path.join(KIT, entry)],
  bundle: true, platform, write: false, jsx: "automatic", minify: platform === "browser",
  alias: { "@": REPO }, nodePaths: [path.join(REPO, "node_modules")],
  loader: { ".css": "empty" }, logLevel: "error",
  define: { "process.env.NODE_ENV": '"production"', ...(platform === "browser" ? { "process.env": "{}" } : {}) },
  plugins: [
    { name: "stubs", setup(b) { b.onResolve({ filter: /.*/ }, (a) => STUBS[a.path] ? { path: path.join(KIT, STUBS[a.path]) } : undefined); } },
    serverActions,
    mockIcons,
  ],
  ...rest,
});
const [shellBuild, catalogBuild] = await Promise.all([
  bundle("shell.tsx", "browser", { format: "iife", globalName: "MockShell" }),
  bundle("catalog.tsx", "node", { format: "cjs" }),
]);
const catalogFile = path.join(tmp, "catalog.cjs");
fs.writeFileSync(catalogFile, catalogBuild.outputFiles[0].text);
const silence = console.error;
console.error = () => {}; // React warns about useLayoutEffect on the server; the markup is what we need.
const catalog = createRequire(import.meta.url)(catalogFile).renderCatalog();
console.error = silence;

const unescape = (s) => s.replace(/&amp;/g, "&").replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&quot;/g, '"');
const slots = {};
for (const m of [catalog.html, ...Object.values(catalog.templates)].join("").matchAll(/<[a-z0-9]+\b[^>]*>/g)) {
  const slot = m[0].match(/data-slot="([^"]+)"/)?.[1];
  const cls = m[0].match(/class="([^"]*)"/)?.[1];
  if (slot && cls && !(slot in slots)) slots[slot] = unescape(cls);
}
// Parts the components render without a data-slot of their own.
const after = (slot, re) => {
  const from = catalog.html.indexOf(`data-slot="${slot}"`);
  const m = from < 0 ? null : catalog.html.slice(from).match(re);
  return m?.[1] && unescape(m[1]);
};
Object.assign(slots, {
  "dialog-close": slots["dialog-close"] ?? after("dialog-content", /<button[^>]*class="([^"]*)"[^>]*>\s*<svg[^>]*lucide-x/),
  "sheet-close": slots["sheet-close"] ?? after("sheet-content", /<button[^>]*class="([^"]*)"[^>]*>\s*<svg[^>]*lucide-x/),
  "dropdown-menu-item-indicator": after("dropdown-menu-checkbox-item", /<span[^>]*class="([^"]*)"[^>]*><span data-state/),
  "select-item-indicator": after("select-item", /<span[^>]*class="([^"]*)"[^>]*><span[^>]*><svg/),
});
const REQUIRED = [
  "button", "badge", "input", "textarea", "label", "checkbox", "checkbox-indicator", "switch", "switch-thumb",
  "separator", "skeleton", "avatar", "avatar-fallback", "card", "card-header", "card-title", "card-description",
  "card-action", "card-content", "card-footer", "tabs-list", "tabs-trigger", "table-container", "table", "table-header",
  "table-body", "table-row", "table-head", "table-cell", "dialog-overlay", "dialog-content", "dialog-header",
  "dialog-title", "dialog-description", "dialog-footer", "dialog-close", "sheet-overlay", "sheet-content", "sheet-header",
  "sheet-title", "sheet-description", "sheet-footer", "sheet-close", "dropdown-menu-content", "dropdown-menu-item",
  "dropdown-menu-checkbox-item", "dropdown-menu-item-indicator", "dropdown-menu-label", "dropdown-menu-separator",
  "dropdown-menu-shortcut", "select-trigger", "select-content", "select-item", "select-item-indicator",
  "popover-content", "tooltip-content",
];
for (const k of REQUIRED) if (!slots[k]) throw new Error(`catalog part "${k}" not found — a components/ui component changed shape; update kit/build.mjs or kit/catalog.tsx`);
const kitData = { slots, variants: catalog.variants, templates: catalog.templates };

// ---------- 2. inline the repo's public images ----------
const MIME = { svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };
const inlinePublic = (text) => text.replace(/(["'])\/([\w.-]+\.(svg|png|jpe?g|webp))\1/g, (m, q, f, ext) => {
  const file = path.join(REPO, "public", f);
  return !fs.existsSync(file) ? m : `${q}data:${MIME[ext]};base64,${fs.readFileSync(file).toString("base64")}${q}`;
});
const shell = inlinePublic(shellBuild.outputFiles[0].text);
const runtime = runtimeJs;
const app = inlinePublic(appJs);

// ---------- 3. compile globals.css with the repo's Tailwind over everything the page uses ----------
fs.writeFileSync(path.join(tmp, "shell.js"), shell);
fs.writeFileSync(path.join(tmp, "kit.json"), JSON.stringify(kitData));
fs.writeFileSync(path.join(tmp, "runtime.js"), runtime);
fs.writeFileSync(path.join(tmp, "app.js"), app);
const globalsPath = path.join(REPO, "app/globals.css");
const css = await postcss([tailwind({ base: REPO })]).process(
  fs.readFileSync(globalsPath, "utf8") + `\n@source "${tmp}";\n`,
  { from: globalsPath },
);

// ---------- 4. one HTML file ----------
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const script = (s) => s.replace(/<\/script/gi, "<\\/script");
const html = `<!doctype html>
<html lang="es-AR">
<meta charset="utf-8">
<title>${esc(config.title ?? slug)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=swap">
<script>${script(fs.readFileSync(path.join(KIT, "theme-boot.js"), "utf8"))}</script>
<style>${css.css}
:root{--font-geist-sans:"Geist",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;--font-geist-mono:"Geist Mono",ui-monospace,SFMono-Regular,Menlo,monospace}
html,body{height:100%}body{margin:0;font-family:var(--font-sans);-webkit-font-smoothing:antialiased}
${fs.readFileSync(path.join(KIT, "mock.css"), "utf8")}</style>
<body class="min-h-svh bg-background text-foreground antialiased">
<div id="mock-root"></div>
<div id="mock-layer"></div>
<script>window.KIT=${script(JSON.stringify(kitData))};window.MOCK_CONFIG=${script(JSON.stringify(config))};</script>
<script>${script(shell)}</script>
<script>${script(runtime)}</script>
<script>${script(app)}</script>
</body>
</html>`;

const out = path.join(mockDir, `${slug}.html`);
fs.writeFileSync(out, html);
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`built ${out} (${(html.length / 1024).toFixed(0)} KB) from ${REPO}`);
// The required catalog bundle can leave timers behind; the build is done.
process.exit(0);
