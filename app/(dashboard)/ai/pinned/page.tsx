import { redirect } from "next/navigation";
import { Suspense } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { listAiPinnedArtifactsAction } from "@/features/ai/actions/pinned-actions";
import { PinnedArtifacts } from "@/features/ai/components/pinned-artifacts";
import { aiKeys } from "@/features/ai/lib/ai-keys";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";

export const dynamic = "force-dynamic";

export default async function AiPinnedRoute() {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "ai:chat")) {
    redirect("/dashboard");
  }
  const dehydratedState = await prefetchQueries([
    {
      queryKey: aiKeys.pinned(),
      queryFn: () => runAction(() => listAiPinnedArtifactsAction()),
    },
  ]);
  return (
    <Hydrate state={dehydratedState}>
      <Suspense
        fallback={
          <div className="grid gap-4 lg:grid-cols-2">
            <Skeleton className="h-64" />
            <Skeleton className="h-64" />
          </div>
        }
      >
        <PinnedArtifacts />
      </Suspense>
    </Hydrate>
  );
}
