import { FileIcon, FileImage, FileSpreadsheet, FileText } from "lucide-react";

import { isImage, isPdf, isSpreadsheet } from "@/lib/files/preview";

// A component instead of `const Icon = iconForMimeType(...)` in render, which
// the React Compiler lint flags as creating a component during render.
export function MimeIcon({
  mimeType,
  className,
}: {
  mimeType: string | null | undefined;
  className?: string;
}) {
  if (isImage(mimeType)) return <FileImage className={className} />;
  if (isPdf(mimeType)) return <FileText className={className} />;
  if (isSpreadsheet(mimeType)) return <FileSpreadsheet className={className} />;
  return <FileIcon className={className} />;
}
