import { Skeleton } from "@/components/ui/skeleton";

export default function SupplierCategoryDetailLoading() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-4 w-[280px]" />
      <Skeleton className="h-8 w-[240px]" />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-24 rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-96 w-full rounded-lg" />
    </div>
  );
}
