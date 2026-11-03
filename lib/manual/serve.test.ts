import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { adaptManualPage, MANUAL_DIR, manualFile } from "./serve";

describe("manualFile", () => {
  it("serves the pages and their assets", () => {
    expect(manualFile(["sales.html"])).toMatchObject({
      relative: "sales.html",
      isPage: true,
    });
    expect(manualFile(["assets", "styles.css"])).toMatchObject({
      relative: "assets/styles.css",
      contentType: "text/css; charset=utf-8",
      isPage: false,
    });
    expect(manualFile(["assets", "manual.js"])?.contentType).toBe(
      "text/javascript; charset=utf-8",
    );
  });

  it("refuses anything else", () => {
    for (const segments of [
      [],
      ["..", "package.json"],
      ["README.md"],
      [".env"],
      ["assets", "..", "x.js"],
      ["assets", "x.html"],
      ["other", "styles.css"],
      ["assets", "sub", "x.js"],
      ["styles.css"],
      ["%2e%2e"],
    ]) {
      expect(manualFile(segments), segments.join("/")).toBeNull();
    }
  });

  it("every file of the manual the app should serve is reachable", () => {
    const pages = readdirSync(MANUAL_DIR).filter((f) => f.endsWith(".html"));
    const assets = readdirSync(path.join(MANUAL_DIR, "assets"));
    for (const page of pages) expect(manualFile([page]), page).not.toBeNull();
    for (const asset of assets) {
      expect(manualFile(["assets", asset]), asset).not.toBeNull();
    }
  });
});

describe("adaptManualPage", () => {
  const page = [
    "<head>",
    '  <link rel="preconnect" href="https://fonts.googleapis.com" />',
    '  <link href="https://fonts.googleapis.com/css2?family=Geist" rel="stylesheet" />',
    '  <link rel="stylesheet" href="assets/styles.css" />',
    "</head>",
    '<script src="assets/manual.js"></script>',
    "<script>",
  ].join("\n");

  it("puts the nonce on every script and drops the font links", () => {
    const out = adaptManualPage(page, "YWJj");
    expect(out).toContain('<script nonce="YWJj" src="assets/manual.js">');
    expect(out).toContain('<script nonce="YWJj">');
    expect(out).not.toContain("fonts.googleapis.com");
    expect(out).toContain('href="assets/styles.css"');
  });

  it("adds no nonce that is missing or could break out of the attribute", () => {
    expect(adaptManualPage(page, null)).not.toContain("nonce=");
    expect(adaptManualPage(page, '"><img')).not.toContain("nonce=");
  });

  it("each page loads its scripts relatively, so the nonce reaches them", () => {
    const html = readFileSync(path.join(MANUAL_DIR, "index.html"), "utf8");
    expect(existsSync(path.join(MANUAL_DIR, "assets", "manual.js"))).toBe(true);
    expect(adaptManualPage(html, "YWJj")).toMatch(
      /<script nonce="YWJj" src="assets\/manual\.js">/,
    );
  });
});
