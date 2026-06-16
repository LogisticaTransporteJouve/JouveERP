import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";

import { messageText } from "./chat-store";

describe("messageText", () => {
  it("joins text parts and ignores non-text parts", () => {
    const message: UIMessage = {
      id: "m1",
      role: "user",
      parts: [
        { type: "text", text: "¿cuánto" },
        { type: "step-start" },
        { type: "text", text: "me debe Acme?" },
      ],
    };
    expect(messageText(message)).toBe("¿cuánto me debe Acme?");
  });

  it("returns an empty string when there is no text", () => {
    const message: UIMessage = {
      id: "m2",
      role: "assistant",
      parts: [{ type: "step-start" }],
    };
    expect(messageText(message)).toBe("");
  });
});
