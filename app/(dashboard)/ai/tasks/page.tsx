import { redirect } from "next/navigation";

import { listAiWorkflowsAction } from "@/features/ai/workflows/actions";
import { WorkflowsPage } from "@/features/ai/workflows/components/workflows-page";
import { workflowsKeys } from "@/features/ai/workflows/lib/workflows-keys";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function AiTasksRoute({
  searchParams,
}: {
  searchParams: Promise<{ workflow?: string }>;
}) {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "ai:chat")) {
    redirect("/dashboard");
  }
  const { workflow } = await searchParams;
  const dehydratedState = await prefetchQueries([
    {
      queryKey: workflowsKeys.list(),
      queryFn: () => runAction(() => listAiWorkflowsAction()),
    },
  ]);
  return (
    <Hydrate state={dehydratedState}>
      <WorkflowsPage
        initialWorkflowId={
          workflow && UUID_RE.test(workflow) ? workflow : undefined
        }
      />
    </Hydrate>
  );
}
