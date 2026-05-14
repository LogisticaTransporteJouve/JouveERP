import { describe, expect, it } from "vitest";

import {
  CreateGroupSchema,
  EditMessageSchema,
  QUICK_REACTIONS,
  SendMessageSchema,
  ToggleReactionSchema,
} from "./schema";

const UUID = "f47ac10b-58cc-4372-a567-0e02b2c3d479";

describe("SendMessageSchema", () => {
  it("accepts a valid message", () => {
    const res = SendMessageSchema.safeParse({
      channelId: UUID,
      body: "Hola",
    });
    expect(res.success).toBe(true);
  });

  it("accepts a reply with replyToId", () => {
    const res = SendMessageSchema.safeParse({
      channelId: UUID,
      body: "Hola",
      replyToId: UUID,
    });
    expect(res.success).toBe(true);
  });

  it("rejects empty bodies", () => {
    const res = SendMessageSchema.safeParse({ channelId: UUID, body: "   " });
    expect(res.success).toBe(false);
  });

  it("rejects oversized bodies (>4000 chars)", () => {
    const res = SendMessageSchema.safeParse({
      channelId: UUID,
      body: "x".repeat(4001),
    });
    expect(res.success).toBe(false);
  });

  it("rejects non-UUID channelId", () => {
    const res = SendMessageSchema.safeParse({
      channelId: "not-a-uuid",
      body: "hola",
    });
    expect(res.success).toBe(false);
  });

  it("trims surrounding whitespace", () => {
    const res = SendMessageSchema.safeParse({
      channelId: UUID,
      body: "   hola   ",
    });
    if (!res.success) throw new Error("expected success");
    expect(res.data.body).toBe("hola");
  });
});

describe("EditMessageSchema", () => {
  it("accepts a valid edit", () => {
    const res = EditMessageSchema.safeParse({
      messageId: UUID,
      body: "actualizado",
    });
    expect(res.success).toBe(true);
  });

  it("rejects empty body", () => {
    const res = EditMessageSchema.safeParse({
      messageId: UUID,
      body: "",
    });
    expect(res.success).toBe(false);
  });
});

describe("ToggleReactionSchema", () => {
  it("accepts a valid emoji", () => {
    const res = ToggleReactionSchema.safeParse({
      messageId: UUID,
      emoji: "👍",
    });
    expect(res.success).toBe(true);
  });

  it("rejects emojis longer than 16 chars", () => {
    const res = ToggleReactionSchema.safeParse({
      messageId: UUID,
      emoji: "x".repeat(17),
    });
    expect(res.success).toBe(false);
  });

  it("rejects empty emoji", () => {
    const res = ToggleReactionSchema.safeParse({ messageId: UUID, emoji: "" });
    expect(res.success).toBe(false);
  });
});

describe("CreateGroupSchema", () => {
  it("accepts valid input", () => {
    const res = CreateGroupSchema.safeParse({
      name: "Logística",
      memberIds: [UUID],
    });
    expect(res.success).toBe(true);
  });

  it("rejects empty name", () => {
    const res = CreateGroupSchema.safeParse({
      name: "",
      memberIds: [UUID],
    });
    expect(res.success).toBe(false);
  });

  it("rejects no members", () => {
    const res = CreateGroupSchema.safeParse({
      name: "Logística",
      memberIds: [],
    });
    expect(res.success).toBe(false);
  });

  it("rejects more than 50 members", () => {
    const res = CreateGroupSchema.safeParse({
      name: "Big",
      memberIds: Array.from({ length: 51 }, () => UUID),
    });
    expect(res.success).toBe(false);
  });

  it("rejects name longer than 60 chars", () => {
    const res = CreateGroupSchema.safeParse({
      name: "x".repeat(61),
      memberIds: [UUID],
    });
    expect(res.success).toBe(false);
  });
});

describe("QUICK_REACTIONS", () => {
  it("are non-empty and unique", () => {
    expect(QUICK_REACTIONS.length).toBeGreaterThan(0);
    expect(new Set(QUICK_REACTIONS).size).toBe(QUICK_REACTIONS.length);
  });
});
