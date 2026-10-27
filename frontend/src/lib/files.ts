import { api } from './api';

/** Mirrors operations/validators.py: the backend stays the final judge. */
export const MAX_UPLOAD_MB = 10;
export const ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp';

const KIND_BY_EXTENSION: Record<string, 'pdf' | 'jpg' | 'png' | 'webp'> = {
  pdf: 'pdf',
  jpg: 'jpg',
  jpeg: 'jpg',
  png: 'png',
  webp: 'webp',
};

/** The file's real type from its first bytes (like the backend's filetype.guess). */
function sniff(head: Uint8Array): 'pdf' | 'jpg' | 'png' | 'webp' | null {
  const at = (i: number, ...bytes: number[]): boolean => bytes.every((b, k) => head[i + k] === b);
  if (at(0, 0x25, 0x50, 0x44, 0x46)) return 'pdf'; // %PDF
  if (at(0, 0xff, 0xd8, 0xff)) return 'jpg';
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'png';
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'webp'; // RIFF....WEBP
  return null;
}

/**
 * Checks a file before uploading it, the same way the server will: size, extension, and
 * that the content really is that type (an .exe renamed to .jpg is refused).
 * Returns an i18n key, or null when the file looks fine.
 */
export async function checkUpload(file: File): Promise<string | null> {
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) return 'documents.too_large';
  const extension = file.name.includes('.') ? (file.name.split('.').pop() ?? '').toLowerCase() : '';
  const expected = KIND_BY_EXTENSION[extension];
  if (!expected) return 'documents.bad_type';
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  return sniff(head) === expected ? null : 'documents.content_mismatch';
}

/**
 * Fetches a document through the authenticated endpoint (Bearer token, branch check) and
 * returns an object URL for it. The caller revokes it with URL.revokeObjectURL when done.
 */
export async function fetchDocumentUrl(downloadUrl: string, attachment = false): Promise<string> {
  const path = downloadUrl.replace(/^\/api/, '');
  const response = await api.get<Blob>(path, {
    responseType: 'blob',
    params: attachment ? { download: 1 } : undefined,
  });
  return URL.createObjectURL(response.data);
}

/** '1.4 MB', '820 KB' — with the digits converted by `d`. */
export function formatSize(bytes: number | null, d: (s: string | number) => string): string {
  if (bytes === null) return '—';
  if (bytes >= 1024 * 1024) return `${d((bytes / 1024 / 1024).toFixed(1))} MB`;
  return `${d(Math.max(1, Math.round(bytes / 1024)))} KB`;
}
