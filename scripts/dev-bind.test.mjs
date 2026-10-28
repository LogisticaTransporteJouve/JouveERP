// In dev mode Inngest checks no signature, so the local servers listen on
// loopback only: another device on the network could otherwise trigger jobs.
//
//   pnpm test:scripts

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const { scripts, devDependencies } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

test("next dev binds 127.0.0.1", () => {
  assert.match(scripts.dev, /^next dev .*-H 127\.0\.0\.1(\s|$)/);
});

// Without a port of its own, next dev moves to 3001 when 3000 is taken, while
// the Inngest dev server still calls 3000.
test("next dev fails rather than leave the port Inngest calls", () => {
  assert.match(scripts.dev, /\s(-p|--port) 3000(\s|$)/);
});

test("the Inngest dev server binds 127.0.0.1 and calls the app there", () => {
  assert.match(scripts["dev:inngest"], /\s--host 127\.0\.0\.1(\s|$)/);
  assert.match(
    scripts["dev:inngest"],
    /\s-u http:\/\/127\.0\.0\.1:3000\/api\/inngest(\s|$)/,
  );
});

test("the Inngest CLI is pinned, not fetched as @latest", () => {
  assert.match(scripts["dev:inngest"], /^inngest-cli /);
  assert.match(devDependencies["inngest-cli"], /^\d+\.\d+\.\d+$/);
});
