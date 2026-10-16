import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  ACTING_TOKEN_TTL_SECONDS,
  getActingUser,
  mintAccessToken,
  runAsUser,
} from "./acting-user";

const SECRET = "test-secret-with-at-least-32-characters";

function decode(part: string): unknown {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

describe("mintAccessToken", () => {
  it("signs an HS256 token for the user with the authenticated role", () => {
    const token = mintAccessToken(
      { userId: "u1", email: "a@b.c" },
      SECRET,
      1_000,
    );
    const [header, payload, signature] = token.split(".");
    expect(decode(header ?? "")).toEqual({ alg: "HS256", typ: "JWT" });
    expect(decode(payload ?? "")).toEqual({
      sub: "u1",
      email: "a@b.c",
      role: "authenticated",
      aud: "authenticated",
      iat: 1_000,
      exp: 1_000 + ACTING_TOKEN_TTL_SECONDS,
    });
    const expected = createHmac("sha256", SECRET)
      .update(`${header}.${payload}`)
      .digest("base64url");
    expect(signature).toBe(expected);
  });

  it("does not verify under another secret", () => {
    const token = mintAccessToken({ userId: "u1", email: "" }, SECRET, 1);
    const [header, payload, signature] = token.split(".");
    const forged = createHmac("sha256", "another-secret")
      .update(`${header}.${payload}`)
      .digest("base64url");
    expect(signature).not.toBe(forged);
  });
});

describe("runAsUser", () => {
  it("scopes the acting user to the callback, including across awaits", async () => {
    expect(getActingUser()).toBeUndefined();
    const seen = await runAsUser(
      { userId: "u1", email: "", accessToken: "t1" },
      async () => {
        await new Promise((r) => setTimeout(r, 1));
        return getActingUser()?.userId;
      },
    );
    expect(seen).toBe("u1");
    expect(getActingUser()).toBeUndefined();
  });

  it("keeps concurrent runs apart", async () => {
    const run = (userId: string, delay: number) =>
      runAsUser({ userId, email: "", accessToken: userId }, async () => {
        await new Promise((r) => setTimeout(r, delay));
        return getActingUser()?.userId;
      });
    expect(await Promise.all([run("a", 5), run("b", 1)])).toEqual(["a", "b"]);
  });
});
