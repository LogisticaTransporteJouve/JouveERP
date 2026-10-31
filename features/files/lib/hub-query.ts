import { runAction } from "@/lib/query/run-action";

import { listHubFilesAction } from "../actions/hub-actions";
import type { HubFilesPage, HubFilters } from "../schema";
import { filesKeys } from "./files-keys";
import type { HubCursor } from "./hub";

export const HUB_PAGE_SIZE = 50;

export function hubFilesQuery(filters: HubFilters) {
  return {
    queryKey: filesKeys.hub(filters),
    queryFn: ({ pageParam }: { pageParam: HubCursor | null }) =>
      runAction(() =>
        listHubFilesAction({
          ...filters,
          cursor: pageParam,
          limit: HUB_PAGE_SIZE,
        }),
      ),
    initialPageParam: null,
    getNextPageParam: (last: HubFilesPage) => last.nextCursor ?? undefined,
  };
}
