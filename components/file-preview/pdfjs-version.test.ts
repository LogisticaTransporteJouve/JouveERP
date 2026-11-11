import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function versionAt(pkgDir: string): string {
  const pkg: unknown = JSON.parse(
    readFileSync(join(pkgDir, "package.json"), "utf8"),
  );
  return pkg && typeof pkg === "object" && "version" in pkg
    ? String(pkg.version)
    : "";
}

describe("pdf.js versions", () => {
  // The viewers load the worker from the app's pdfjs-dist; pdf.js refuses a
  // worker whose version differs from the library react-pdf imports.
  it("react-pdf resolves the same pdfjs-dist as the app", () => {
    const reactPdf = realpathSync(
      join(process.cwd(), "node_modules/react-pdf"),
    );
    const app = versionAt(join(process.cwd(), "node_modules/pdfjs-dist"));
    expect(app).not.toBe("");
    expect(versionAt(join(reactPdf, "..", "pdfjs-dist"))).toBe(app);
  });
});
