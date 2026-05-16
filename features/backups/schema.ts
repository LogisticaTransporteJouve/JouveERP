export const BACKUPS_PATH = "/admin/backups";

export type BackupFile = {
  name: string;
  size: number;
  createdAt: string;
  sha256: string | null;
};
