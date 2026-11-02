import { redirect } from "next/navigation";

import {
  listTasksAction,
  listTaskUserOptionsAction,
} from "@/features/tasks/actions/tasks-actions";
import { TasksView } from "@/features/tasks/components/tasks-view";
import { tasksKeys } from "@/features/tasks/lib/tasks-keys";
import {
  DEFAULT_TASK_SCOPE,
  DEFAULT_TASK_STATUS,
} from "@/features/tasks/schema";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";

export const dynamic = "force-dynamic";

export default async function TasksPage() {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "tasks:read")) {
    redirect("/dashboard");
  }
  const dehydratedState = await prefetchQueries([
    {
      queryKey: tasksKeys.list(DEFAULT_TASK_SCOPE, DEFAULT_TASK_STATUS),
      queryFn: () =>
        runAction(() =>
          listTasksAction({
            scope: DEFAULT_TASK_SCOPE,
            status: DEFAULT_TASK_STATUS,
          }),
        ),
    },
    {
      queryKey: tasksKeys.users(),
      queryFn: () => runAction(() => listTaskUserOptionsAction()),
    },
  ]);
  return (
    <Hydrate state={dehydratedState}>
      <TasksView canWrite={userCan(ctx.access, "tasks:write")} />
    </Hydrate>
  );
}
