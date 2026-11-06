export const accountingSettingsKeys = {
  all: ["accounting-settings"] as const,
  detail: () => [...accountingSettingsKeys.all, "detail"] as const,
};
