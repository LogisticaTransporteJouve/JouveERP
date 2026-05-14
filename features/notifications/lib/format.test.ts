import { describe, expect, it } from "vitest";

import type { Notification } from "../types";

import {
  formatNotificationTime,
  getNotificationHref,
  getNotificationPreview,
  getNotificationTitle,
} from "./format";

const baseNotif: Notification = {
  id: "n1",
  recipient_id: "u1",
  sender_id: "u2",
  type: "chat_message",
  metadata: {},
  read_at: null,
  created_at: "2026-05-14T12:00:00Z",
  sender_first_name: null,
  sender_last_name: null,
  sender_email: null,
  sender_avatar_path: null,
  sender_avatar_color: null,
  sender_avatar_url: null,
};

describe("getNotificationHref", () => {
  it("returns /chat/<id> when type is chat_message with channel_id", () => {
    const notif: Notification = {
      ...baseNotif,
      metadata: { channel_id: "abc" },
    };
    expect(getNotificationHref(notif)).toBe("/chat/abc");
  });

  it("returns the same for chat_reply and chat_mention", () => {
    for (const type of ["chat_reply", "chat_mention"] as const) {
      const notif = {
        ...baseNotif,
        type,
        metadata: { channel_id: "abc" },
      };
      expect(getNotificationHref(notif)).toBe("/chat/abc");
    }
  });

  it("returns null when channel_id is missing", () => {
    expect(getNotificationHref(baseNotif)).toBeNull();
  });

  it("returns null for unknown types", () => {
    const notif = { ...baseNotif, type: "something_else" };
    expect(getNotificationHref(notif)).toBeNull();
  });
});

describe("getNotificationTitle", () => {
  it("differs by type", () => {
    expect(
      getNotificationTitle({ ...baseNotif, type: "chat_message" }),
    ).toContain("mensaje");
    expect(
      getNotificationTitle({ ...baseNotif, type: "chat_reply" }),
    ).toContain("respondió");
    expect(
      getNotificationTitle({ ...baseNotif, type: "chat_mention" }),
    ).toContain("mencionó");
  });
});

describe("getNotificationPreview", () => {
  it("returns preview from metadata when present", () => {
    const notif = { ...baseNotif, metadata: { preview: "Hola" } };
    expect(getNotificationPreview(notif)).toBe("Hola");
  });

  it("returns empty string when preview missing", () => {
    expect(getNotificationPreview(baseNotif)).toBe("");
  });
});

describe("formatNotificationTime", () => {
  it("returns a non-empty string", () => {
    const out = formatNotificationTime(new Date().toISOString());
    expect(out.length).toBeGreaterThan(0);
  });
});
