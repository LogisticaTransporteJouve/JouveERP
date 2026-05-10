import { Skeleton } from "@/components/ui/skeleton";

export default function PuntosDeVentaLoading() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Skeleton className="h-7 w-[150px]" />
        <div className="flex gap-2">
          <Skeleton className="h-9 w-[110px]" />
          <Skeleton className="h-9 w-[170px]" />
        </div>
      </div>
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <Skeleton className="h-4 w-[180px]" />
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-4 w-full" />
        ))}
      </div>
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <Skeleton className="h-4 w-[160px]" />
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    </div>
  );
}
