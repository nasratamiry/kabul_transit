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
