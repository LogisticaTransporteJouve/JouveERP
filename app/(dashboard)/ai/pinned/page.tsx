import { redirect } from "next/navigation";

import { PinnedArtifacts } from "@/features/ai/components/pinned-artifacts";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";

export const dynamic = "force-dynamic";

export default async function AiPinnedRoute() {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "ai:chat")) {
    redirect("/dashboard");
  }
  return <PinnedArtifacts />;
}
