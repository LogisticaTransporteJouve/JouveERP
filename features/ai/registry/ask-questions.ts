import { tool } from "ai";

import { askQuestionsInputSchema } from "../lib/questions";

/**
 * The question card. No `execute`: the model's call ends the turn, the chat
 * renders the card, and the user's answers come back as this call's output
 * (app/api/ai/chat accepts them as `questionAnswers`), so the model continues
 * from a structured tool result instead of free text.
 */
export const askQuestionsTool = tool({
  description:
    "Ask the user 1-8 short structured questions on a card when you need a " +
    "choice or a missing fact before answering or proposing (which employee, " +
    "which period, which account). kind: single (one option), multi (one or " +
    "more), text (free answer). Give options with value + label; allowOther " +
    "adds a free 'Otro'. The turn ends on this call; the answers arrive as its " +
    "result. Never ask for something a tool can look up.",
  inputSchema: askQuestionsInputSchema,
});
