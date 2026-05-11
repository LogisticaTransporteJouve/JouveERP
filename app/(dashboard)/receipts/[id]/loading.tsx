import { Skeleton } from "@/components/ui/skeleton";

export default function ReceiptDetailLoading() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-4 w-64" />
      <Skeleton className="h-8 w-80" />
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-40 lg:col-span-2" />
        <Skeleton className="h-40" />
      </div>
    </div>
  );
}
