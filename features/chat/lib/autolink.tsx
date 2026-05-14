import { Fragment } from "react";

// Detecta URLs http/https en texto plano y las convierte en <a>. No
// procesa Markdown ni emoji — solo URLs simples. Lo usamos en lectura,
// nunca al guardar.
//
// Conservador: el regex es greedy con un set de chars permitidos +
// trims trailing punctuation común para no enganchar ")" al final.

const URL_RE = /\bhttps?:\/\/[^\s<>()]+/g;

const TRAIL_TRIM = /[.,;:!?)]+$/;

export function autolink(text: string): React.ReactNode[] {
  if (!text) return [text];
  const out: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const re = new RegExp(URL_RE);
  while ((match = re.exec(text)) !== null) {
    const raw = match[0];
    const trail = raw.match(TRAIL_TRIM);
    const trimmed = trail ? raw.slice(0, -trail[0].length) : raw;
    const start = match.index;
    if (start > lastIndex) {
      out.push(<Fragment key={`t-${lastIndex}`}>{text.slice(lastIndex, start)}</Fragment>);
    }
    out.push(
      <a
        key={`l-${start}`}
        href={trimmed}
        target="_blank"
        rel="noreferrer noopener"
        className="underline underline-offset-2 hover:no-underline"
      >
        {trimmed}
      </a>,
    );
    lastIndex = start + trimmed.length;
  }
  if (lastIndex < text.length) {
    out.push(<Fragment key={`t-${lastIndex}`}>{text.slice(lastIndex)}</Fragment>);
  }
  return out;
}
