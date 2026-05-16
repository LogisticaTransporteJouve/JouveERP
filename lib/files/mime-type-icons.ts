import {
  FileIcon,
  FileImage,
  FileSpreadsheet,
  FileText,
  type LucideIcon,
} from "lucide-react";

import { isImage, isPdf, isSpreadsheet } from "./preview";

export function iconForMimeType(mime?: string | null): LucideIcon {
  if (isImage(mime)) return FileImage;
  if (isPdf(mime)) return FileText;
  if (isSpreadsheet(mime)) return FileSpreadsheet;
  return FileIcon;
}
