import { test as setup } from "@playwright/test";

import { signInAndSaveState } from "./sign-in";

setup("authenticate", async ({ page, baseURL }) => {
  await signInAndSaveState(page, baseURL ?? "http://localhost:3000");
});
