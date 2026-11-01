"use client";

import { marked } from "marked";

import { useIsClient } from "@/hooks/use-is-client";
import DOMPurify from "dompurify";

// Chat-style markdown rendering: bold, italic, inline code, code blocks,
// lists, blockquote, links. No headings, no tables, no raw HTML —
// the composer is plain text, we don't want a user to inject
// `<script>` even though the sanitizer would reject it anyway.
//
// The parser runs with `gfm: true` so that `**text**`, `_text_` and
// triple backticks work as you'd expect. DOMPurify runs on top of it
// to strip out anything marked didn't anticipate.

const renderer = new marked.Renderer();

renderer.heading = ({ text }) => `<p>${text}</p>`; // headings → plain paragraph
renderer.image = () => ""; // no inline images
// We let raw HTML through and DOMPurify cleans it up below. If we
// strip it here we lose the surrounding text content.

marked.setOptions({
  gfm: true,
  breaks: true, // a single line break = <br>
  renderer,
});

const SANITIZE_CONFIG = {
  ALLOWED_TAGS: [
    "p",
    "br",
    "strong",
    "em",
    "code",
    "pre",
    "ul",
    "ol",
    "li",
    "blockquote",
    "a",
  ],
  ALLOWED_ATTR: ["href", "target", "rel"],
  FORBID_TAGS: ["script", "style", "iframe", "form", "input"],
  KEEP_CONTENT: true,
};

export function renderMarkdown(body: string): string {
  const html = marked.parse(body, { async: false }) as string;
  return DOMPurify.sanitize(html, SANITIZE_CONFIG);
}

export function MarkdownBody({ body }: { body: string }) {
  // DOMPurify needs a DOM: on the server (and the hydration pass) the text
  // renders plain, then the sanitized HTML replaces it in the browser. The
  // server-side sanitizer (isomorphic-dompurify → jsdom) failed to load on
  // the serverless runtime.
  const isClient = useIsClient();
  if (!isClient) {
    return (
      <div className="prose-chat text-sm leading-relaxed whitespace-pre-wrap">
        {body}
      </div>
    );
  }
  // dangerouslySetInnerHTML is OK because we already sanitized. Tailwind v4
  // styling does not include `prose` by default — we use direct classes
  // in the selectors below.
  return (
    <div
      className="prose-chat text-sm leading-relaxed"
      dangerouslySetInnerHTML={{ __html: renderMarkdown(body) }}
    />
  );
}
