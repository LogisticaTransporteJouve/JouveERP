export const tripsKeys = {
  all: ["trips"] as const,
  list: () => [...tripsKeys.all, "list"] as const,
  companionOptions: () => [...tripsKeys.all, "companionOptions"] as const,
};
