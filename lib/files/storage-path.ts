// Storage path helpers for the `files` bucket.
//
// The object key never contains the user's original filename — that lives
// in `files.original_filename`. Spaces, unicode, traversal sequences and
// >255-char names therefore never reach storage; signed URLs stay stable.
// The object key is `{uuid}` or `{uuid}.{ext}`; the extension is only
// appended when it's a short ASCII-safe lowercase token.

const SAFE_EXTENSION_PATTERN = /^[a-z0-9]{1,8}$/;

export function getSafeExtension(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot === -1 || lastDot === filename.length - 1) {
    return "";
  }
  const extension = filename.slice(lastDot + 1).toLowerCase();
  return SAFE_EXTENSION_PATTERN.test(extension) ? extension : "";
}

export function buildStorageKey(fileId: string, filename: string): string {
  const extension = getSafeExtension(filename);
  return extension ? `${fileId}.${extension}` : fileId;
}
