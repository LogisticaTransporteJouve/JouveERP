/** Query keys for the sidebar guide. */
export const guideKeys = {
  all: ["guide"] as const,
  state: () => [...guideKeys.all, "state"] as const,
};
