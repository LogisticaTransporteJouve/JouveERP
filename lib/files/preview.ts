// MIME type guards for preview rendering and conditional UI.

export const isImage = (mime?: string | null): boolean =>
  !!mime && mime.startsWith("image/");

export const isPdf = (mime?: string | null): boolean =>
  mime === "application/pdf";

export const isSpreadsheet = (mime?: string | null): boolean =>
  mime === "text/csv" ||
  mime === "application/vnd.ms-excel" ||
  mime ===
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
