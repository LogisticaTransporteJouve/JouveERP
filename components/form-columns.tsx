import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** DialogContent width for a form too tall for one column on a 14"–15"
 *  notebook: wider, with its fields in `FormColumns`, it fits without
 *  scrolling. */
export const WIDE_FORM_DIALOG = "sm:max-w-4xl";

/** The fields of a form side by side in two `FormColumn`s. It splits by the
 *  form's own width (a container query), not the screen's: one column on a
 *  phone or when the form shares the dialog with a document preview. */
export function FormColumns({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className="@container">
      <div
        className={cn(
          "grid grid-cols-1 items-start gap-x-6 gap-y-4 @2xl:grid-cols-2",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}

export function FormColumn({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("min-w-0 space-y-4", className)}>{children}</div>;
}
