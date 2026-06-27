import DOMPurify from "isomorphic-dompurify";
import { Marked } from "marked";

// Markdown rendering for AI assistant output. The team-chat composer
// (features/chat/lib/markdown) deliberately strips headings and tables because
// it renders untrusted user input; AI replies are trusted server-generated
// text that lean on headings, tables and lists, so we keep those. An isolated
// Marked instance avoids clobbering the chat's global marked config. DOMPurify
// still runs as defense-in-depth against prompt-injected HTML.

const md = new Marked({ gfm: true, breaks: true, async: false });

const SANITIZE_CONFIG = {
  ALLOWED_TAGS: [
    "p", "br", "hr", "strong", "em", "del", "code", "pre",
    "ul", "ol", "li", "blockquote", "a",
    "h1", "h2", "h3", "h4", "h5", "h6",
    "table", "thead", "tbody", "tr", "th", "td",
  ],
  ALLOWED_ATTR: ["href", "target", "rel"],
  FORBID_TAGS: ["script", "style", "iframe", "form", "input", "img"],
  KEEP_CONTENT: true,
};

export function renderAiMarkdown(body: string): string {
  const html = md.parse(body) as string;
  return DOMPurify.sanitize(html, SANITIZE_CONFIG);
}

export function AiMarkdown({ body }: { body: string }) {
  // dangerouslySetInnerHTML is safe here: the HTML is sanitized above.
  return (
    <div
      className="prose-ai text-sm leading-relaxed"
      dangerouslySetInnerHTML={{ __html: renderAiMarkdown(body) }}
    />
  );
}
