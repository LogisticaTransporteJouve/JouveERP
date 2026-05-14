import { Skeleton } from "@/components/ui/skeleton";

export default function SupplierDetailLoading() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-24 w-full rounded-lg" />
      <Skeleton className="h-96 w-full rounded-lg" />
    </div>
  );
}
