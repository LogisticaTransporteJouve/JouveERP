import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** DialogContent width for a form too tall for one column on a 14"–15"
 *  notebook: wider, with its fields in `FormColumns`, it fits without
 *  scrolling. */
export const WIDE_FORM_DIALOG = "sm:max-w-4xl";

/** The fields of a form side by side in two `FormColumn`s. It splits by the
 *  form's own width (a container query), not the screen's: one column on a
 *  phone or when the form shares the dialog with a document preview.
 *  Two `FormColumn`s stack independently, so their rows drift apart when one
 *  side holds something taller than an input; for fields that pair up across
 *  the columns, pass one `FormColumn` per cell in reading order (row 1 left,
 *  row 1 right, row 2 left…) and each row lines up. */
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

/** DialogContent for a form that holds unbounded lists (payment lines,
 *  comprobantes to impute, items). From `lg` the dialog is a capped flex
 *  column: the form takes the height left under the header, its lists shrink
 *  and scroll inside their own box (`FIT_LIST`), and the dialog never does.
 *  Below `lg` it stacks in one column and scrolls like any dialog. */
export const LIST_FORM_DIALOG =
  "sm:max-w-[min(90vw,90rem)] lg:flex lg:flex-col lg:overflow-hidden";

/** The `<form>` inside a `LIST_FORM_DIALOG`: `ListFormColumns` + footer. */
export const LIST_FORM =
  "space-y-4 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col lg:gap-4 lg:space-y-0";

/** The root of a list section (title + list) inside a `ListFormColumns`
 *  column: from `lg` it gives up height so its `FIT_LIST` can scroll. */
export const FIT_LIST_SECTION = "lg:flex lg:min-h-0 lg:flex-col";

/** The list box itself: scrolls inside once the column runs out of room.
 *  `relative` keeps Radix's hidden native selects inside the box, or they
 *  would stretch the dialog's own scroll height. */
export const FIT_LIST = "lg:relative lg:min-h-16 lg:overflow-y-auto";

/** Two columns that share the dialog's height (see `LIST_FORM_DIALOG`). */
export function ListFormColumns({
  left,
  right,
}: {
  left: ReactNode;
  right: ReactNode;
}) {
  const column =
    "min-w-0 space-y-3 lg:flex lg:min-h-0 lg:flex-1 lg:basis-0 lg:flex-col lg:gap-3 lg:space-y-0";
  return (
    <div className="space-y-3 lg:flex lg:min-h-0 lg:flex-1 lg:gap-6 lg:space-y-0">
      <div className={column}>{left}</div>
      <div className={column}>{right}</div>
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
