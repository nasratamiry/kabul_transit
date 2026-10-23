import { useTranslation } from 'react-i18next';

const PERSIAN_ZERO = 0x06f0; // ۰
const ARABIC_ZERO = 0x0660; // ٠

/** Persian (۰-۹) and Arabic (٠-٩) digits → English, then trim. Same as backend normalize_digits. */
export function normalizeDigits(s: string): string {
  return s
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - PERSIAN_ZERO))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - ARABIC_ZERO))
    .trim();
}

/** English digits → Persian digits. Display only; never send the result to the API. */
export function toDariDigits(s: string | number): string {
  return String(s).replace(/[0-9]/g, (d) => String.fromCharCode(PERSIAN_ZERO + Number(d)));
}

export const isRtlLang = (lang: string): boolean => lang === 'fa' || lang === 'ps';

/** Digit converter for the current UI language: Persian digits for fa/ps, English for en. */
export function useDigitLocale(): (s: string | number) => string {
  const { i18n } = useTranslation();
  return isRtlLang(i18n.language) ? toDariDigits : (s) => String(s);
}
