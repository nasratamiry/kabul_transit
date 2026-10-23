import moment from 'jalali-moment';

import { isRtlLang, normalizeDigits, toDariDigits } from './digits';

const ISO = 'YYYY-MM-DD';
const KABUL_OFFSET_MINUTES = 270; // UTC+04:30, no DST

type DateInput = Date | string;

/** Today's calendar date in Kabul, independent of the browser's time zone (matches backend kabul_today). */
export function kabulToday(): Date {
  const now = new Date();
  const kabul = new Date(now.getTime() + KABUL_OFFSET_MINUTES * 60_000);
  return new Date(kabul.getUTCFullYear(), kabul.getUTCMonth(), kabul.getUTCDate());
}

/**
 * A Shamsi year is 13xx/14xx; a Gregorian year is 19xx/20xx. Anything with a year < 1700
 * is treated as Shamsi. Accepts '-', '/' or '.' separators and any digit script.
 */
const SHAMSI_RE = /^(1[3-6]\d\d)[-/.](\d{1,2})[-/.](\d{1,2})$/;
const GREGORIAN_RE = /^((?:19|20|21)\d\d)[-/.](\d{1,2})[-/.](\d{1,2})$/;

function toMoment(d: DateInput): moment.Moment {
  if (d instanceof Date) return moment(d);
  return moment(parseAnyDate(d));
}

/** Parse a Shamsi or Gregorian date string (Dari, Arabic or English digits). Throws on invalid input. */
export function parseAnyDate(s: string): Date {
  const text = normalizeDigits(s);
  const datePart = text.split(/[T\s]/)[0] ?? '';
  let m: moment.Moment | null = null;
  if (SHAMSI_RE.test(datePart)) {
    const [, y, mo, da] = SHAMSI_RE.exec(datePart) ?? [];
    m = moment.from(`${y}-${mo?.padStart(2, '0')}-${da?.padStart(2, '0')}`, 'fa', ISO);
  } else if (GREGORIAN_RE.test(datePart)) {
    // Full ISO datetimes keep their time and zone; bare dates are local midnight.
    m = datePart === text ? moment(datePart.replace(/[/.]/g, '-'), ISO, true) : moment(text);
  }
  if (!m || !m.isValid()) throw new Error(`Invalid date: ${s}`);
  return m.toDate();
}

/** → '۱۴۰۵-۰۸-۰۱' (Persian digits). */
export function toShamsi(d: DateInput): string {
  return toDariDigits(toMoment(d).locale('fa').format(ISO));
}

/** Shamsi string (any digits) → '2026-10-23'. */
export function toGregorian(shamsi: string): string {
  return moment(parseAnyDate(shamsi)).locale('en').format(ISO);
}

export function dualDate(d: DateInput): { shamsi: string; gregorian: string } {
  const m = toMoment(d);
  return {
    shamsi: toDariDigits(m.clone().locale('fa').format(ISO)),
    gregorian: m.clone().locale('en').format(ISO),
  };
}

/** Shamsi with Persian digits for fa/ps, Gregorian for en. */
export function formatDate(d: DateInput, lang: string): string {
  return isRtlLang(lang) ? toShamsi(d) : toMoment(d).locale('en').format(ISO);
}

// ---------------------------------------------------------------------------
// Shamsi calendar helpers for <DateInput>. Shamsi values are 'YYYY-MM-DD' strings with
// English digits — exactly what the API's jDateField reads and writes.
// ---------------------------------------------------------------------------

/** Afghan (Dari/Pashto) solar month names; English uses the Dari names transliterated. */
export const SHAMSI_MONTHS: Record<string, string[]> = {
  fa: ['حمل', 'ثور', 'جوزا', 'سرطان', 'اسد', 'سنبله', 'میزان', 'عقرب', 'قوس', 'جدی', 'دلو', 'حوت'],
  ps: [
    'وری',
    'غویی',
    'غبرګولی',
    'چنګاښ',
    'زمری',
    'وږی',
    'تله',
    'لړم',
    'لیندۍ',
    'مرغومی',
    'سلواغه',
    'کب',
  ],
  en: [
    'Hamal',
    'Sawr',
    'Jawza',
    'Saratan',
    'Asad',
    'Sunbula',
    'Mizan',
    'Aqrab',
    'Qaws',
    'Jadi',
    'Dalw',
    'Hut',
  ],
};

/** Week starts on Saturday. */
export const WEEKDAYS: Record<string, string[]> = {
  fa: ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'],
  ps: ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'],
  en: ['Sa', 'Su', 'Mo', 'Tu', 'We', 'Th', 'Fr'],
};

/** Shamsi 'YYYY-MM-DD' (English digits) for a date. */
export function shamsiKey(d: DateInput): string {
  return toMoment(d).locale('fa').format(ISO);
}

/** Today in Kabul as Shamsi 'YYYY-MM-DD' with English digits (the API's own format). */
export function todayShamsi(): string {
  return shamsiKey(kabulToday());
}

/** Any accepted date text → Shamsi 'YYYY-MM-DD' (English digits), or null if invalid. */
export function toShamsiKey(text: string): string | null {
  try {
    return shamsiKey(parseAnyDate(text));
  } catch {
    return null;
  }
}

export interface ShamsiMonth {
  year: number;
  month: number; // 0-based
  /** Leading blanks so day 1 lands on its weekday (Saturday = column 0). */
  offset: number;
  days: string[]; // Shamsi keys, day 1..n
}

export function shamsiMonth(year: number, month: number): ShamsiMonth {
  const first = moment.from(`${year}-${String(month + 1).padStart(2, '0')}-01`, 'fa', ISO);
  const count = moment.jDaysInMonth(year, month);
  return {
    year,
    month,
    offset: (first.day() + 1) % 7,
    days: Array.from({ length: count }, (_, i) =>
      first.clone().add(i, 'day').locale('fa').format(ISO),
    ),
  };
}

/** Shift a Shamsi key by days or Shamsi months. */
export function shiftShamsi(key: string, amount: number, unit: 'day' | 'month'): string {
  const m = moment.from(key, 'fa', ISO);
  return (unit === 'day' ? m.add(amount, 'day') : m.add(amount, 'jMonth')).locale('fa').format(ISO);
}

/** API timestamp (ISO, UTC) → Kabul-time 'date time' in Shamsi (Persian digits) and Gregorian. */
export function dualDateTime(iso: string): { shamsi: string; gregorian: string } {
  const m = moment.utc(iso).utcOffset(KABUL_OFFSET_MINUTES);
  return {
    shamsi: toDariDigits(m.clone().locale('fa').format('YYYY-MM-DD HH:mm')),
    gregorian: m.clone().locale('en').format('YYYY-MM-DD HH:mm'),
  };
}

/** Backend dual_date() text 'Shamsi | Gregorian' → its two halves. */
export function splitDualDate(text: string): { shamsi: string; gregorian: string } {
  const [shamsi = text, gregorian = ''] = text.split(' | ');
  return { shamsi: toDariDigits(shamsi.replace(/\//g, '-')), gregorian };
}
