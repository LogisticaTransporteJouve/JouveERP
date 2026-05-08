import "server-only";

import type { z } from "zod";

import { requireUserContext, type UserContext } from "@/lib/auth/context";
import { userCan, type Permission } from "@/lib/auth/permissions";
import { logger } from "@/lib/logger";

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly code: "UNAUTHENTICATED" | "FORBIDDEN" | "VALIDATION",
  ) {
    super(message);
    this.name = "AuthError";
  }
}

type WithAuthOptions<TInput> = {
  permission?: Permission;
  schema?: z.ZodType<TInput>;
};

type Handler<TInput, TResult> = (args: {
  context: UserContext;
  input: TInput;
}) => Promise<TResult>;

/**
 * Wraps a server action with: authentication check, permission check,
 * and Zod input validation. Throws AuthError for the unhappy paths so the
 * caller can map them to user-facing strings without leaking detail.
 */
export function withAuth<TInput = undefined, TResult = unknown>(
  options: WithAuthOptions<TInput>,
  handler: Handler<TInput, TResult>,
) {
  return async (input?: unknown): Promise<TResult> => {
    const context = await requireUserContext().catch((error) => {
      logger.warn("withAuth.unauthenticated", { error });
      throw new AuthError("Unauthenticated", "UNAUTHENTICATED");
    });

    if (options.permission && !userCan(context.roles, options.permission)) {
      logger.warn("withAuth.forbidden", {
        userId: context.userId,
        permission: options.permission,
        roles: context.roles,
      });
      throw new AuthError("Forbidden", "FORBIDDEN");
    }

    let parsedInput: TInput;
    if (options.schema) {
      const parsed = options.schema.safeParse(input);
      if (!parsed.success) {
        throw new AuthError("Invalid input", "VALIDATION");
      }
      parsedInput = parsed.data;
    } else {
      parsedInput = input as TInput;
    }

    return handler({ context, input: parsedInput });
  };
}
