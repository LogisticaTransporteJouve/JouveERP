// Cases for scripts/dev/restamp-migrations.sh, each in a throwaway clone whose
// `origin/main` holds the merged migrations.
//
//   pnpm test:scripts

import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(
  new URL("./dev/restamp-migrations.sh", import.meta.url),
);
const MIGRATIONS = "supabase/migrations";

// Same isolation as check-migrations.test.mjs: no outer GIT_* and no global
// config.
const ENV = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  ),
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

const git = (cwd, ...args) => {
  const r = spawnSync("git", args, { cwd, env: ENV, encoding: "utf8" });
  assert.equal(r.status, 0, `git ${args.join(" ")} failed:\n${r.stderr}`);
  return r.stdout.trim();
};

/** UTC `YYYYMMDDHHMMSS` of a Date. */
const stamp = (date) => date.toISOString().replace(/\D/g, "").slice(0, 14);

/**
 * Pushes `merged` to a bare origin's main, adds `added` on a branch of a
 * clone and runs the restamp there; returns its exit code, output and the
 * migrations left on disk.
 */
const restamp = ({ merged, added }) => {
  const root = mkdtempSync(join(tmpdir(), "restamp-migrations-"));
  try {
    const origin = join(root, "origin.git");
    const work = join(root, "work");
    git(root, "init", "-q", "--bare", "-b", "main", origin);
    git(root, "clone", "-q", origin, work);
    mkdirSync(join(work, "scripts/dev"), { recursive: true });
    copyFileSync(SCRIPT, join(work, "scripts/dev/restamp-migrations.sh"));
    mkdirSync(join(work, MIGRATIONS), { recursive: true });
    for (const name of merged) writeFileSync(join(work, MIGRATIONS, name), "");
    git(work, "add", ".");
    git(work, "commit", "-q", "-m", "base");
    git(work, "push", "-q", "origin", "HEAD:main");
    git(work, "checkout", "-q", "-b", "feature");
    for (const name of added) writeFileSync(join(work, MIGRATIONS, name), "");
    git(work, "add", ".");
    git(work, "commit", "-q", "-m", "change");
    const r = spawnSync(
      "bash",
      [join(work, "scripts/dev/restamp-migrations.sh")],
      {
        cwd: work,
        env: ENV,
        encoding: "utf8",
        timeout: 30_000,
      },
    );
    return {
      code: r.status,
      output: `${r.stdout}${r.stderr}`,
      files: readdirSync(join(work, MIGRATIONS)).sort(),
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

test("with main behind the clock it stamps the current UTC time", () => {
  const before = stamp(new Date());
  const { code, output, files } = restamp({
    merged: ["20260101000000_first.sql"],
    added: ["20250101000000_a.sql", "20250101000001_b.sql"],
  });
  const after = stamp(new Date(Date.now() + 2_000));
  assert.equal(code, 0, output);
  const [, a, b] = files;
  assert.match(a, /_a\.sql$/);
  assert.match(b, /_b\.sql$/);
  assert.ok(a.slice(0, 14) >= before && a.slice(0, 14) <= after, a);
  assert.ok(b.slice(0, 14) > a.slice(0, 14), b);
});

test("with main ahead of the clock it stamps the next real second after it", () => {
  // Minute 61 an hour from now, as a hand-typed future stamp would be.
  const ahead = new Date(Date.now() + 3_600_000);
  const day = stamp(ahead).slice(0, 8);
  const hour = stamp(ahead).slice(8, 10);
  const merged = `${day}${hour}6100_typed.sql`;
  const { code, output, files } = restamp({
    merged: [merged],
    added: ["20250101000000_a.sql", "20250101000001_b.sql"],
  });
  assert.equal(code, 0, output);
  const carried = new Date(
    Date.UTC(
      Number(day.slice(0, 4)),
      Number(day.slice(4, 6)) - 1,
      Number(day.slice(6, 8)),
      Number(hour),
      61,
      1,
    ),
  );
  assert.deepEqual(files, [
    merged,
    `${stamp(carried)}_a.sql`,
    `${stamp(new Date(carried.getTime() + 1_000))}_b.sql`,
  ]);
});
