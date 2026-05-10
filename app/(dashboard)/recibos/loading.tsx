import { Skeleton } from "@/components/ui/skeleton";

export default function RecibosLoading() {
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Skeleton className="h-9 w-[150px]" />
      </div>
      <div className="rounded-lg border bg-card">
        <div className="space-y-3 p-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4">
              <Skeleton className="h-4 w-[180px]" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-4 w-[100px]" />
              <Skeleton className="h-4 w-[120px]" />
              <Skeleton className="h-5 w-[110px] rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
