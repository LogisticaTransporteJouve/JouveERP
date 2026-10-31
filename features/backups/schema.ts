export type BackupFile = {
  name: string;
  size: number;
  createdAt: string;
  sha256: string | null;
};

// Strict allow-list: only backup-YYYY-MM-DD.dump. The anchored regex already
// blocks '/', '\\', '..' and '\0'; the explicit checks are defense in
// depth against path traversal (CWE-22) in case the pattern changes.
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
