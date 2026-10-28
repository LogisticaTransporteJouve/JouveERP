import { redirect } from "next/navigation";

import { listJournalEntriesAction } from "@/features/journal-entries/actions/journal-entries-actions";
import { JournalList } from "@/features/journal-entries/components/journal-list";
import { journalEntriesKeys } from "@/features/journal-entries/lib/journal-entries-keys";
import {
  currentPeriod,
  type JournalFilters,
} from "@/features/journal-entries/schema";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function JournalPage() {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "accounting:read")) {
    redirect("/dashboard");
  }

  const supabase = await createClient();
  const channelsRes = await supabase
    .from("invoicing_channels")
    .select("id, name")
    .eq("is_active", true)
    .order("name");

  const initialFilters: JournalFilters = {
    period: currentPeriod(),
    sourceTable: "all",
    channelId: null,
  };

  const dehydratedState = await prefetchQueries([
    {
      queryKey: journalEntriesKeys.list(initialFilters),
      queryFn: () => runAction(() => listJournalEntriesAction(initialFilters)),
    },
  ]);

  return (
    <Hydrate state={dehydratedState}>
      <JournalList
        channels={channelsRes.data ?? []}
        initialFilters={initialFilters}
      />
    </Hydrate>
  );
}
