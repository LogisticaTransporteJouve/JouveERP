import { Fragment } from "react";

// Detects http/https URLs in plain text and turns them into <a>. Does not
// process Markdown or emoji — only plain URLs. We use it on read,
// never on save.
//
// Conservative: the regex is greedy with an allowed char set +
// trims common trailing punctuation so it doesn't grab a ")" at the end.

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
