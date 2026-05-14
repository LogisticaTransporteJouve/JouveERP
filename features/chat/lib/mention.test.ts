import { describe, expect, it } from "vitest";

import type { ChannelMember } from "../types";

import { applyMention, filterMembersByQuery, findMentionAtCursor } from "./mention";

const member = (overrides: Partial<ChannelMember> = {}): ChannelMember => ({
  user_id: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  email: "tomas@jouve.test",
  first_name: "Tomás",
  last_name: "Dziurdzia",
  avatar_path: null,
  avatar_color: null,
  avatar_url: null,
  role: "member",
  ...overrides,
});

describe("findMentionAtCursor", () => {
  it("detects an @ at the start of the body", () => {
    const out = findMentionAtCursor("@tom", 4);
    expect(out).toEqual({ triggerStart: 0, query: "tom" });
  });

  it("detects an @ after whitespace", () => {
    const out = findMentionAtCursor("hola @tom", 9);
    expect(out).toEqual({ triggerStart: 5, query: "tom" });
  });

  it("returns null when the @ is part of an email", () => {
    expect(findMentionAtCursor("hola@jouve", 10)).toBeNull();
  });

  it("returns null when there's whitespace between @ and cursor", () => {
    expect(findMentionAtCursor("@tom uno", 8)).toBeNull();
  });

  it("returns null when no @ is found", () => {
    expect(findMentionAtCursor("texto plano", 11)).toBeNull();
  });

  it("returns empty query when @ is right before the cursor", () => {
    const out = findMentionAtCursor("hola @", 6);
    expect(out).toEqual({ triggerStart: 5, query: "" });
  });
});

describe("applyMention", () => {
  it("replaces the partial @query with the full name plus a trailing space", () => {
    const cursor = { triggerStart: 0, query: "tom" };
    const out = applyMention("@tom", cursor, member());
    expect(out.body).toBe("@Tomás Dziurdzia ");
    expect(out.cursorPos).toBe(out.body.length);
  });

  it("preserves text after the cursor", () => {
    const cursor = { triggerStart: 5, query: "tom" };
    const out = applyMention("hola @tom como", cursor, member());
    expect(out.body).toBe("hola @Tomás Dziurdzia como");
  });

  it("falls back to email local-part if no name set", () => {
    const cursor = { triggerStart: 0, query: "" };
    const out = applyMention("@", cursor, member({ first_name: null, last_name: null }));
    expect(out.body).toBe("@tomas ");
  });
});

describe("filterMembersByQuery", () => {
  const members: ChannelMember[] = [
    member({ user_id: "u1", first_name: "Tomás", last_name: "D" }),
    member({ user_id: "u2", first_name: "Ana", last_name: "García", email: "ana@x.com" }),
    member({ user_id: "u3", first_name: "Tom", last_name: "Hanks" }),
  ];

  it("excludes the current user", () => {
    const out = filterMembersByQuery(members, "", "u1");
    expect(out.map((m) => m.user_id)).toEqual(["u2", "u3"]);
  });

  it("matches by name", () => {
    const out = filterMembersByQuery(members, "ana", "u1");
    expect(out).toHaveLength(1);
    expect(out[0]!.user_id).toBe("u2");
  });

  it("matches by email", () => {
    const out = filterMembersByQuery(members, "ana@", "u1");
    expect(out).toHaveLength(1);
  });

  it("is case-insensitive", () => {
    expect(filterMembersByQuery(members, "TOM", "u3")).toHaveLength(1);
  });

  it("returns the first 8 when query is empty", () => {
    const out = filterMembersByQuery(members, "", "u1");
    expect(out.length).toBeLessThanOrEqual(8);
  });
});
