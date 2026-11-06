import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      // `max-w-full`: a fixed-width placeholder (`w-[420px]`) never pushes a
      // phone screen sideways while the page loads.
      className={cn("max-w-full animate-pulse rounded-md bg-accent", className)}
      {...props}
    />
  );
}

export { Skeleton };
