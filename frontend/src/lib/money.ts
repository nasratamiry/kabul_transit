import { isRtlLang, normalizeDigits, toDariDigits } from './digits';

export type Currency = 'AFN' | 'USD';

const SYMBOL: Record<Currency, { rtl: string; ltr: string }> = {
  AFN: { rtl: '؋', ltr: 'AFN' },
  USD: { rtl: '$', ltr: '$' },
};

/**
 * 2 decimals with grouping. fa/ps: Persian digits, '٬' thousands, '٫' decimal.
 * Works on the decimal string, never through float, so 14-digit DecimalField values stay exact.
 * Null-safe: null/undefined/'' → '—'.
 */
export function formatMoney(
  amount: string | number | null | undefined,
  currency: Currency,
  lang = 'fa',
): string {
  if (amount === null || amount === undefined || amount === '') return '—';
  const text = normalizeDigits(String(amount)).replace(/[,\s٬]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(text)) return '—';

  const negative = text.startsWith('-');
  const [intRaw = '0', fracRaw = ''] = text.replace('-', '').split('.');
  const frac = roundFraction(intRaw, fracRaw);
  const rtl = isRtlLang(lang);
  const grouped = frac.int.replace(/\B(?=(\d{3})+(?!\d))/g, rtl ? '٬' : ',');
  const number = `${negative ? '-' : ''}${grouped}${rtl ? '٫' : '.'}${frac.dec}`;

  if (rtl) return `${toDariDigits(number)} ${SYMBOL[currency].rtl}`;
  return currency === 'USD' ? `$${number}` : `${number} AFN`;
}

/** Round half-up to 2 decimals on digit strings. */
function roundFraction(intPart: string, fracPart: string): { int: string; dec: string } {
  const padded = (fracPart + '000').slice(0, 3);
  let cents = BigInt(intPart + padded.slice(0, 2));
  if (Number(padded[2]) >= 5) cents += 1n;
  const s = cents.toString().padStart(3, '0');
  return { int: s.slice(0, -2).replace(/^0+(?=\d)/, ''), dec: s.slice(-2) };
}
