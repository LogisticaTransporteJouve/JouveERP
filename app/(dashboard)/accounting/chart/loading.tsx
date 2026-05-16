import { Skeleton } from "@/components/ui/skeleton";

export default function ChartOfAccountsLoading() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-7 w-[240px]" />
          <Skeleton className="h-4 w-[420px]" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-[120px]" />
          <Skeleton className="h-9 w-[120px]" />
          <Skeleton className="h-9 w-[140px]" />
        </div>
      </div>
      <div className="rounded-lg border">
        <div className="space-y-2 p-3">
          {Array.from({ length: 10 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-3"
              style={{ paddingLeft: `${(i % 4) * 20}px` }}
            >
              <Skeleton className="size-4" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-5 w-24 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
