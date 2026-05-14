import { marked } from "marked";
import DOMPurify from "isomorphic-dompurify";

// Render de markdown chat-style: bold, italic, code inline, code blocks,
// listas, blockquote, links. Sin headings, sin tablas, sin HTML raw —
// el composer es texto plano, no nos interesa que un usuario meta
// `<script>` aunque vaya a fallar el sanitizer.
//
// El parser corre con `gfm: true` para que `**text**`, `_text_` y
// triple backtick funcionen como esperás. DOMPurify le pasa por encima
// para sacar lo que marked no esperaba.

const renderer = new marked.Renderer();

renderer.heading = ({ text }) => `<p>${text}</p>`; // headings → párrafo plain
renderer.image = () => "";                          // no imágenes inline
// HTML raw lo dejamos pasar y DOMPurify lo limpia abajo. Si lo
// stripeamos acá perdemos el text content alrededor.

marked.setOptions({
  gfm: true,
  breaks: true,                                     // un salto de línea = <br>
  renderer,
});

const SANITIZE_CONFIG = {
  ALLOWED_TAGS: [
    "p", "br", "strong", "em", "code", "pre", "ul", "ol", "li",
    "blockquote", "a",
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
  // dangerouslySetInnerHTML es OK porque ya sanitizamos. Tailwind v4
  // styling no incluye `prose` por default — usamos clases directas
  // en los selectores debajo.
  return (
    <div
      className="prose-chat text-sm leading-relaxed"
      dangerouslySetInnerHTML={{ __html: renderMarkdown(body) }}
    />
  );
}
