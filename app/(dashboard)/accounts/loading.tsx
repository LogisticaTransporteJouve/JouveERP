import { Skeleton } from "@/components/ui/skeleton";

export default function CuentasLoading() {
  return (
    <div className="rounded-lg border bg-card">
      <div className="space-y-3 p-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4">
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 w-[120px]" />
            <Skeleton className="h-4 w-[60px]" />
            <Skeleton className="h-4 w-[120px]" />
            <Skeleton className="h-4 w-[80px]" />
          </div>
        ))}
      </div>
    </div>
  );
}
