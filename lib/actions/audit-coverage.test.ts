import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

// Every "use server" file under features/ that writes (a PostgREST insert,
// update, upsert or delete, or a write RPC) calls logAudit somewhere. A file
// that writes only what does not need an audit trail is listed below with its
// reason. The check is per file: a new write in an audited file is the
// reviewer's to catch.

const ROOT = join(__dirname, "..", "..");

const EXEMPT: Record<string, string> = {
  "features/profile/actions/upload-avatar.ts":
    "the user's own avatar, a personal preference",
  "features/profile/actions/update-profile.ts":
    "the user's own name and preferences",
  "features/chat/actions/messages.ts":
    "chat messages carry their author and time; no business record changes",
  "features/chat/actions/channels.ts":
    "creating a DM or group and marking it read are the user's own chat state",
  "features/chat/actions/channel-admin.ts":
    "chat membership and mute live in the chat tables with who changed them",
  "features/notifications/actions/push-actions.ts":
    "the device's own push subscription",
  "features/notifications/actions/notifications-actions.ts":
    "marking the user's own notifications read",
  "features/notifications/actions/settings-actions.ts":
    "the user's own notification settings",
  "features/clients/actions/afip-actions.ts":
    "only refreshes padron_cache, a cache of AFIP's public registry",
  "features/dashboard/actions/dashboard-actions.ts":
    "the user's own dashboard layout",
  "features/guide/actions/guide-state-actions.ts":
    "the user's own sidebar guide state (collapsed, items marked done)",
};

const TABLE_WRITE = /\.(insert|update|upsert|delete)\(/;
const RPC_WRITE =
  /\.rpc\(\s*"(apply|clear|create|update|upsert|delete|set|mark|add|remove|pay|cancel|close|reopen|reject|deposit|credit|replace|open_or_create|get_or_create)_/;

function serverActionFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return serverActionFiles(path);
    if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) {
      return [];
    }
    const source = readFileSync(path, "utf8");
    return /^\s*["']use server["']/.test(source) ? [path] : [];
  });
}

const FILES = serverActionFiles(join(ROOT, "features")).map((path) => ({
  file: relative(ROOT, path).replaceAll("\\", "/"),
  source: readFileSync(path, "utf8"),
}));

function writesWithoutAudit(source: string): boolean {
  return (
    (TABLE_WRITE.test(source) || RPC_WRITE.test(source)) &&
    !source.includes("logAudit(")
  );
}

describe("server actions audit their writes", () => {
  it("finds the server action files", () => {
    expect(FILES.length).toBeGreaterThan(50);
  });

  it("every writing action file calls logAudit or is exempt with a reason", () => {
    const missing = FILES.filter(
      ({ file, source }) => writesWithoutAudit(source) && !(file in EXEMPT),
    ).map(({ file }) => file);
    expect(missing).toEqual([]);
  });

  it("every exemption still names a file that writes without logAudit", () => {
    const byFile = new Map(FILES.map(({ file, source }) => [file, source]));
    const stale = Object.keys(EXEMPT).filter((file) => {
      const source = byFile.get(file);
      return source === undefined || !writesWithoutAudit(source);
    });
    expect(stale).toEqual([]);
  });
});
