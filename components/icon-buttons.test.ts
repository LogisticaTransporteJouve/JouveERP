import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// A button that shows only an icon renders IconButton, which requires a label
// and shows it as a tooltip, so the user can tell what the button does.
// This scan finds the two shapes that skip it: a Button sized as an icon, and
// a Button or <button> whose only content is an icon (also wrapped in an
// asChild Link or <a>, or next to an sr-only span).

// The calendar's day cells are Buttons sized as icons, but they show the day
// number, not an icon.
const ICON_SIZE_ALLOWED = new Set(["components/ui/calendar.tsx"]);

const ROOT = path.resolve(import.meta.dirname, "..");
const SCANNED = ["app", "components", "features"];
const SKIPPED = new Set(["components/ui/icon-button.tsx"]);

function sources(dir: string): string[] {
  return readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap(
    (entry) => {
      const rel = path.posix.join(dir, entry.name);
      if (entry.isDirectory()) return sources(rel);
      return entry.name.endsWith(".tsx") && !entry.name.endsWith(".test.tsx")
        ? [rel]
        : [];
    },
  );
}

/** Index just past the `>` that closes the tag opened at `start`. */
function tagEnd(
  text: string,
  start: number,
): { end: number; selfClosing: boolean } {
  let depth = 0;
  let quote: string | null = null;
  for (let i = start + 1; i < text.length; i++) {
    const c = text.charAt(i);
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
    } else if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === '"' || c === "'" || (depth > 0 && c === "`")) quote = c;
    else if (c === ">" && depth === 0)
      return { end: i + 1, selfClosing: text[i - 1] === "/" };
  }
  return { end: text.length, selfClosing: true };
}

/** The children of the element whose opening tag ends at `from`. */
function children(text: string, from: number, name: string): string {
  const tag = new RegExp(`<(/?)${name}(?=[\\s>/])`, "g");
  tag.lastIndex = from;
  let depth = 1;
  for (let m = tag.exec(text); m; m = tag.exec(text)) {
    if (m[1]) {
      if (--depth === 0) return text.slice(from, m.index);
    } else {
      const { end, selfClosing } = tagEnd(text, m.index);
      if (!selfClosing) depth++;
      tag.lastIndex = end;
    }
  }
  return "";
}

/** Removes every self-closing component element, such as `<Eye className="size-4" />`. */
function withoutIcons(body: string): { rest: string; icons: number } {
  let rest = body;
  let icons = 0;
  for (let m = /<[A-Z][\w.]*(?=[\s/])/.exec(rest); m;) {
    const { end, selfClosing } = tagEnd(rest, m.index);
    if (!selfClosing) return { rest, icons: 0 };
    rest = rest.slice(0, m.index) + rest.slice(end);
    icons++;
    m = /<[A-Z][\w.]*(?=[\s/])/.exec(rest);
  }
  return { rest, icons };
}

/** True when the children render nothing but icons (a ternary between icons counts). */
function isIconOnly(raw: string): boolean {
  let body = raw.replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
  body = body.replace(/<span className="sr-only">[^<]*<\/span>/g, "");
  const wrapper = /^\s*<(Link|a)(?=[\s>])/.exec(body)?.[1];
  if (wrapper) {
    const open = body.indexOf("<");
    const { end, selfClosing } = tagEnd(body, open);
    if (selfClosing) return false;
    body = children(body, end, wrapper);
  }
  // Every expression container must hold an icon and no string; anything else
  // ({label}, "texto", <span>) is visible content.
  const groups = body.match(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g) ?? [];
  const outside = groups.reduce((acc, g) => acc.replace(g, ""), body);
  const top = withoutIcons(outside);
  if (top.rest.trim() !== "") return false;
  let icons = top.icons;
  for (const group of groups) {
    const inner = withoutIcons(group.slice(1, -1));
    if (inner.icons === 0 || /["'`]/.test(inner.rest) || /</.test(inner.rest))
      return false;
    icons += inner.icons;
  }
  return icons > 0;
}

type Offender = { file: string; line: number; why: string };

function offenders(file: string, text: string): Offender[] {
  const found: Offender[] = [];
  const opening = /<(Button|button)(?=[\s>])/g;
  for (let m = opening.exec(text); m; m = opening.exec(text)) {
    const name = m[1];
    if (!name) continue;
    const line = text.slice(0, m.index).split("\n").length;
    const { end, selfClosing } = tagEnd(text, m.index);
    const tag = text.slice(m.index, end);
    if (/\ssize="icon/.test(tag) && !ICON_SIZE_ALLOWED.has(file))
      found.push({ file, line, why: "sized as an icon" });
    else if (!selfClosing && isIconOnly(children(text, end, name)))
      found.push({ file, line, why: "only an icon inside" });
  }
  return found;
}

describe("icon buttons", () => {
  const files = SCANNED.flatMap(sources).filter((f) => !SKIPPED.has(f));

  it("render IconButton, so every icon-only button has a tooltip", () => {
    const found = files.flatMap((f) =>
      offenders(f, readFileSync(path.join(ROOT, f), "utf8")),
    );
    expect(found.map((o) => `${o.file}:${o.line} ${o.why}`)).toEqual([]);
  });

  it("keeps the icon-size allowlist exact", () => {
    const stale = [...ICON_SIZE_ALLOWED].filter(
      (f) =>
        !/<Button(?=[\s>])[^>]*\ssize="icon/.test(
          readFileSync(path.join(ROOT, f), "utf8"),
        ),
    );
    expect(stale).toEqual([]);
  });

  it.each([
    [
      '<Button size="icon" aria-label="Ver"><Eye /></Button>',
      "sized as an icon",
    ],
    [
      '<Button variant="ghost" onClick={go}>\n  <Pencil className="size-4" />\n</Button>',
      "only an icon inside",
    ],
    [
      '<button type="button">{open ? <ChevronDown /> : <ChevronRight />}</button>',
      "only an icon inside",
    ],
    [
      '<Button asChild><Link href="/x"><Download className="size-4" /></Link></Button>',
      "only an icon inside",
    ],
    [
      '<Button><X /><span className="sr-only">Cerrar</span></Button>',
      "only an icon inside",
    ],
  ])("flags %s", (source, why) => {
    expect(offenders("x.tsx", source).map((o) => o.why)).toEqual([why]);
  });

  it.each([
    "<Button><Plus /> Nuevo</Button>",
    '<Button>{pending ? "Guardando…" : "Guardar"}</Button>',
    "<Button><Download />{label}</Button>",
    "<button>{label}</button>",
    '<Button asChild><Link href="/x"><Eye /> Ver</Link></Button>',
    '<Button>{done ? <RotateCcw /> : <Check />} {done ? "Reabrir" : "Hecha"}</Button>',
    '<button><UserAvatar name="x" /><span>Ana</span></button>',
  ])("lets %s through", (source) => {
    expect(offenders("x.tsx", source)).toEqual([]);
  });
});
