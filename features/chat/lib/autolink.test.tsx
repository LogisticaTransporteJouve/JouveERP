import { isValidElement, type ReactElement } from "react";
import { describe, expect, it } from "vitest";

import { autolink } from "./autolink";

type AnchorEl = ReactElement<{ href: string; children: React.ReactNode }>;

function isAnchor(node: unknown): node is AnchorEl {
  return isValidElement(node) && (node as { type: unknown }).type === "a";
}

describe("autolink", () => {
  it("returns the original text when no URLs are present", () => {
    const out = autolink("Hola, ¿cómo estás?");
    expect(out.some(isAnchor)).toBe(false);
  });

  it("turns http(s) URLs into anchors", () => {
    const out = autolink("Mirá esto: https://example.com el último");
    const anchors = out.filter(isAnchor);
    expect(anchors).toHaveLength(1);
    expect(anchors[0]!.props.href).toBe("https://example.com");
  });

  it("strips trailing punctuation from the link", () => {
    const out = autolink("(https://example.com).");
    const anchors = out.filter(isAnchor);
    expect(anchors[0]!.props.href).toBe("https://example.com");
  });

  it("handles multiple URLs in one message", () => {
    const out = autolink("dos urls: http://a.com y https://b.com listo");
    const anchors = out.filter(isAnchor);
    expect(anchors).toHaveLength(2);
    expect(anchors[0]!.props.href).toBe("http://a.com");
    expect(anchors[1]!.props.href).toBe("https://b.com");
  });

  it("ignores non-http schemes", () => {
    const out = autolink("ftp://example.com no");
    expect(out.some(isAnchor)).toBe(false);
  });

  it("does not split URLs inside words", () => {
    const out = autolink("nottps://example.com");
    expect(out.some(isAnchor)).toBe(false);
  });

  it("returns the input for empty string", () => {
    expect(autolink("")).toEqual([""]);
  });
});
