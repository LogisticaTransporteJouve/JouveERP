import { redirect } from "next/navigation";

import { AiWorkspace } from "@/features/ai/components/ai-workspace";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";

export const dynamic = "force-dynamic";

export default async function AiRoute({
  searchParams,
}: {
  searchParams: Promise<{ ask?: string }>;
}) {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "ai:chat")) {
    redirect("/dashboard");
  }
  const { ask } = await searchParams;
  return (
    <AiWorkspace
      canManageInsights={userCan(ctx.roles, "ai:admin")}
      initialAsk={ask && ask.trim().length > 0 ? ask : undefined}
    />
  );
}
