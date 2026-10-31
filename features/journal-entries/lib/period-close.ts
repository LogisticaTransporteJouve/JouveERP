import { userCan, type Access } from "@/lib/auth/permissions";

/** Closing or reopening a period freezes or unfreezes every posting in it:
 *  accounting:write, held by an owner or admin. Shared by the actions and the
 *  journal page so the control shows exactly when the action runs. */
export function canManageClosedPeriods(access: Access): boolean {
  return (
    userCan(access, "accounting:write") &&
    access.roles.some((r) => r === "owner" || r === "admin")
  );
}
