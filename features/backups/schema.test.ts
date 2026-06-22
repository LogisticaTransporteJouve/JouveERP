import { describe, expect, it } from "vitest";

import { isValidBackupFileName } from "./schema";

describe("isValidBackupFileName", () => {
  it("acepta el patrón exacto backup-YYYY-MM-DD.dump", () => {
    expect(isValidBackupFileName("backup-2026-06-22.dump")).toBe(true);
    expect(isValidBackupFileName("backup-2025-01-01.dump")).toBe(true);
  });

  it("rechaza path traversal (CWE-22)", () => {
    expect(isValidBackupFileName("../backup-2026-06-22.dump")).toBe(false);
    expect(isValidBackupFileName("..\\backup-2026-06-22.dump")).toBe(false);
    expect(isValidBackupFileName("backup-2026-06-22.dump/..")).toBe(false);
    expect(isValidBackupFileName("foo/backup-2026-06-22.dump")).toBe(false);
    expect(isValidBackupFileName("..%2Fbackup-2026-06-22.dump")).toBe(false);
  });

  it("rechaza separadores de path y NUL byte", () => {
    expect(isValidBackupFileName("backup-2026-06-22.dump\0")).toBe(false);
    expect(isValidBackupFileName("backup-2026-06-22.dump\0.png")).toBe(false);
  });

  it("rechaza extensión o sufijo incorrecto", () => {
    expect(isValidBackupFileName("backup-2026-06-22.txt")).toBe(false);
    expect(isValidBackupFileName("backup-2026-06-22.dump.dump")).toBe(false);
    expect(isValidBackupFileName("backup-2026-06-22")).toBe(false);
  });

  it("rechaza fechas mal formadas (no ancladas / dígitos faltantes)", () => {
    expect(isValidBackupFileName("backup-2026-6-2.dump")).toBe(false);
    expect(isValidBackupFileName("xbackup-2026-06-22.dump")).toBe(false);
    expect(isValidBackupFileName("backup-2026-06-22.dumpx")).toBe(false);
  });

  it("rechaza vacío y tipos no-string", () => {
    expect(isValidBackupFileName("")).toBe(false);
    expect(isValidBackupFileName(null)).toBe(false);
    expect(isValidBackupFileName(undefined)).toBe(false);
    expect(isValidBackupFileName(42)).toBe(false);
  });
});
