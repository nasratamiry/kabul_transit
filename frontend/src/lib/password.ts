export type Strength = 'weak' | 'medium' | 'strong';

// A few of the passwords Django's CommonPasswordValidator rejects; the server has the full list.
const COMMON = new Set([
  'password',
  'password1',
  'password123',
  '12345678',
  '123456789',
  '1234567890',
  '11111111',
  '00000000',
  'qwerty123',
  'qwertyuiop',
  'iloveyou',
  'abc12345',
  'admin123',
  'letmein1',
  'welcome1',
  'kabul123',
  'afghanistan',
  'football',
  'baseball',
  'superman',
  'princess',
]);

/**
 * Client-side approximation of Django's validators (min length 8, not all digits, not too
 * similar to the username, not common), only for the live indicator. The server decides.
 */
export function passwordStrength(password: string, username = ''): Strength | null {
  if (!password) return null;
  const lower = password.toLowerCase();
  const user = username.toLowerCase();
  const similar = user.length >= 3 && (lower.includes(user) || user.includes(lower));
  if (password.length < 8 || /^\d+$/.test(password) || COMMON.has(lower) || similar) return 'weak';
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  return password.length >= 12 && classes >= 3 ? 'strong' : 'medium';
}
