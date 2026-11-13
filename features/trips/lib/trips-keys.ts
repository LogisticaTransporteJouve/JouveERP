export const tripsKeys = {
  all: ["trips"] as const,
  list: () => [...tripsKeys.all, "list"] as const,
  onDate: (date: string) => [...tripsKeys.all, "onDate", date] as const,
  companionOptions: () => [...tripsKeys.all, "companionOptions"] as const,
};
