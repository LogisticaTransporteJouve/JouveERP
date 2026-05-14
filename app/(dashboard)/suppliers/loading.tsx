import { Skeleton } from "@/components/ui/skeleton";

export default function SuppliersLoading() {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Skeleton className="h-9 w-[420px]" />
        <Skeleton className="h-5 w-[100px]" />
      </div>
      <div className="rounded-lg border bg-card">
        <div className="space-y-3 p-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4">
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-4 w-[120px]" />
              <Skeleton className="h-5 w-[140px] rounded-full" />
              <Skeleton className="h-4 w-[80px]" />
              <Skeleton className="h-4 w-[90px]" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
