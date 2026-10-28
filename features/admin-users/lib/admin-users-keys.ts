/**
 * Query keys for the admin-users feature.
 */
export const adminUsersKeys = {
  all: ["admin-users"] as const,
  list: () => [...adminUsersKeys.all, "list"] as const,
  access: (userId: string) =>
    [...adminUsersKeys.all, "access", userId] as const,
};
