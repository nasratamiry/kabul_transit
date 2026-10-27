/**
 * Unsaved form data kept in sessionStorage (this tab only), so a form survives leaving it —
 * e.g. the 428 «today's rate missing» detour, or «add a new trader» from a picker.
 * Storage can be unavailable (private mode); then drafts simply are not kept.
 */
const PREFIX = 'kc.draft:';

export function saveDraft(key: string, values: unknown): void {
  try {
    sessionStorage.setItem(PREFIX + key, JSON.stringify(values));
  } catch {
    /* not kept */
  }
}

export function loadDraft<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function clearDraft(key: string): void {
  try {
    sessionStorage.removeItem(PREFIX + key);
  } catch {
    /* nothing to clear */
  }
}
