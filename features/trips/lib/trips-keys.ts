export const tripsKeys = {
  all: ["trips"] as const,
  list: () => [...tripsKeys.all, "list"] as const,
};
