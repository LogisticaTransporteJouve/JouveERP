import { Skeleton } from "@/components/ui/skeleton";

export default function ClientDetailLoading() {
  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between rounded-lg border bg-muted/30 p-4">
        <div className="space-y-2">
          <Skeleton className="h-3 w-[60px]" />
          <Skeleton className="h-8 w-[180px]" />
          <Skeleton className="h-3 w-[160px]" />
        </div>
        <Skeleton className="h-3 w-[100px]" />
      </div>
      <div className="rounded-lg border bg-card">
        <div className="space-y-3 p-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4">
              <Skeleton className="h-4 w-[100px]" />
              <Skeleton className="h-5 w-[120px] rounded-full" />
              <Skeleton className="h-4 w-[180px]" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-4 w-[100px]" />
              <Skeleton className="h-4 w-[100px]" />
              <Skeleton className="h-4 w-[120px]" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
