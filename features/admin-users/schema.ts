import { z } from "zod";

import { ROLES } from "@/lib/auth/permissions";

export const RoleEnum = z.enum(ROLES);

export const InviteSchema = z.object({
  email: z.string().email(),
  roles: z.array(RoleEnum).min(1),
});

export const AssignSchema = z.object({
  userId: z.string().uuid(),
  roleId: RoleEnum,
});

export const SetRolesSchema = z.object({
  userId: z.string().uuid(),
  roles: z.array(RoleEnum),
});
