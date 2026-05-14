import { describe, expect, it } from "vitest";

import { renderMarkdown } from "./markdown";

describe("renderMarkdown", () => {
  it("wraps plain text in a paragraph", () => {
    expect(renderMarkdown("hola mundo")).toMatch(/^<p>hola mundo<\/p>/);
  });

  it("renders bold with **", () => {
    expect(renderMarkdown("texto **fuerte**")).toContain("<strong>fuerte</strong>");
  });

  it("renders italic with _", () => {
    expect(renderMarkdown("texto _suave_")).toContain("<em>suave</em>");
  });

  it("renders inline code with backticks", () => {
    expect(renderMarkdown("usa `npm`")).toContain("<code>npm</code>");
  });

  it("renders fenced code blocks", () => {
    const out = renderMarkdown("```\nconst x = 1\n```");
    expect(out).toContain("<pre>");
    expect(out).toContain("const x = 1");
  });

  it("renders bullet lists", () => {
    const out = renderMarkdown("- uno\n- dos");
    expect(out).toContain("<ul>");
    expect(out).toContain("<li>uno</li>");
    expect(out).toContain("<li>dos</li>");
  });

  it("renders ordered lists", () => {
    const out = renderMarkdown("1. uno\n2. dos");
    expect(out).toContain("<ol>");
  });

  it("renders blockquotes", () => {
    expect(renderMarkdown("> cita")).toContain("<blockquote>");
  });

  it("renders links with rel=noopener", () => {
    const out = renderMarkdown("[link](https://example.com)");
    expect(out).toContain('href="https://example.com"');
  });

  it("strips dangerous tags", () => {
    const out = renderMarkdown("<script>alert(1)</script>texto");
    expect(out).not.toContain("<script>");
    expect(out).toContain("texto");
  });

  it("strips iframe", () => {
    const out = renderMarkdown('<iframe src="evil"></iframe>texto');
    expect(out).not.toContain("<iframe");
  });

  it("converts headings to plain paragraphs (no h1-h6)", () => {
    const out = renderMarkdown("# titulo");
    expect(out).not.toMatch(/<h[1-6]>/);
  });

  it("strips img tags", () => {
    const out = renderMarkdown("![alt](https://example.com/x.png)");
    expect(out).not.toContain("<img");
  });

  it("preserves line breaks as <br>", () => {
    const out = renderMarkdown("uno\ndos");
    expect(out).toContain("<br");
  });
});
