/** Server actions take the request body whole; Vercel caps it at 4.5 MB. The
 *  upload dropzone and the server action share this limit. */
export const MAX_UPLOAD_TABLE_BYTES = 4 * 1024 * 1024;
