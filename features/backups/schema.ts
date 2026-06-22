export const BACKUPS_PATH = "/admin/backups";

export type BackupFile = {
  name: string;
  size: number;
  createdAt: string;
  sha256: string | null;
};

// Allow-list estricta: solo backup-YYYY-MM-DD.dump. El regex anclado ya impide
// '/', '\\', '..' y '\0'; las comprobaciones explícitas son defensa en
// profundidad contra path traversal (CWE-22) por si el patrón cambia.
const BACKUP_FILE_RE = /^backup-\d{4}-\d{2}-\d{2}\.dump$/;

export function isValidBackupFileName(fileName: unknown): fileName is string {
  if (typeof fileName !== "string" || !BACKUP_FILE_RE.test(fileName)) {
    return false;
  }
  return (
    !fileName.includes("/") &&
    !fileName.includes("\\") &&
    !fileName.includes("..") &&
    !fileName.includes("\0")
  );
}
