import { z } from "zod";

import { PERMISSIONS, ROLES } from "@/lib/auth/permissions";

export const RoleEnum = z.enum(ROLES);
export const PermissionEnum = z.enum(PERMISSIONS);

export const InviteSchema = z.object({
  email: z.string().email(),
  roles: z.array(RoleEnum).min(1),
});

/**
 * One save of the access dialog. `roles` / `denied` null means "unchanged"
 * (the actor may lack the permission to edit that part); the expected arrays
 * are what the dialog loaded, so a save over someone else's change fails.
 */
export const SetAccessSchema = z.object({
  userId: z.string().uuid(),
  roles: z.array(RoleEnum).nullable(),
  denied: z.array(PermissionEnum).nullable(),
  expectedRoles: z.array(RoleEnum),
  expectedDenied: z.array(z.string()),
});

export type SetAccessInput = z.infer<typeof SetAccessSchema>;
