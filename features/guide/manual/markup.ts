import type { GuideText } from "./types";

// The inline markup of a GuideText (see types.ts): parsing it to HTML and
// listing what it quotes, for the renderer and the drift tests alike.

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const TOKEN = /\{\{([^{}]+)\}\}|\[\[([^[\]]+)\]\]|\*\*([^*]+)\*\*|`([^`]+)`/g;

/** A link target: the guide href and the text it shows. */
export type RefResolver = (target: string) => { href: string; text: string };

/** Plain text, for search and the AI: labels in «», links by their text. */
export function toPlainText(text: GuideText, resolve: RefResolver): string {
  return text.replace(
    TOKEN,
    (_m, label: string, ref: string, bold: string, code: string) => {
      if (label !== undefined) return `«${label}»`;
      if (ref !== undefined) return resolve(ref).text;
      return bold ?? code;
    },
  );
}

export function toHtml(text: GuideText, resolve: RefResolver): string {
  let out = "";
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    out += escapeHtml(text.slice(last, m.index));
    last = m.index + m[0].length;
    const [, label, ref, bold, code] = m;
    if (label !== undefined) {
      const safe = escapeHtml(label);
      out += `<span class="ui" data-ui="${safe}">${safe}</span>`;
    } else if (ref !== undefined) {
      const { href, text: shown } = resolve(ref);
      out += `<a class="ref" href="${escapeHtml(href)}">${escapeHtml(shown)}</a>`;
    } else if (bold !== undefined) {
      out += `<strong>${escapeHtml(bold)}</strong>`;
    } else {
      out += `<code>${escapeHtml(code ?? "")}</code>`;
    }
  }
  return out + escapeHtml(text.slice(last));
}

/** The UI labels a text quotes ({{…}}). */
export function quotedLabels(text: GuideText): string[] {
  return [...text.matchAll(/\{\{([^{}]+)\}\}/g)].map((m) => m[1] ?? "");
}

/** The links a text makes ([[…]]): routes ("/x") and anchors ("#x"). */
export function quotedRefs(text: GuideText): string[] {
  return [...text.matchAll(/\[\[([^[\]]+)\]\]/g)].map((m) => m[1] ?? "");
}
