/**
 * What the DVX cabinet window may do (stage 4d; docs/MERHELE-4-EQAIME.md §7). Pure rules, kept
 * apart from Electron so they are tested on their own.
 *
 * - Only the official HTTPS sites: e-taxes.gov.az and the sign-in services it sends the user to
 *   (ASAN İmza, SİMA). A look-alike host ("e-taxes.gov.az.example", "evil-e-taxes.gov.az") is not
 *   theirs. The exact sign-in hosts are to be confirmed with a real sign-in.
 * - Only a spreadsheet export is taken from the cabinet, up to 50 MB.
 * - Tests may point the window at a loopback origin (http://127.0.0.1:<port>) — nothing else.
 */
export const DVX_START = 'https://new.e-taxes.gov.az/etaxes/';
export const DVX_HOSTS = ['e-taxes.gov.az', 'asanimza.az', 'asan.az', 'sima.az'] as const;
export const MAX_DOWNLOAD = 50 * 1024 * 1024;
const LOOPBACK = /^http:\/\/127\.0\.0\.1:\d{2,5}$/;

export function allowedUrl(url: string, testOrigin = ''): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (testOrigin && LOOPBACK.test(testOrigin) && u.origin === testOrigin) return true;
  if (u.protocol !== 'https:' || u.username || u.password) return false;
  const host = u.hostname.toLowerCase();
  return DVX_HOSTS.some((d) => host === d || host.endsWith(`.${d}`));
}

/** Why a download from the cabinet is refused; empty when it is a DVX export to load. */
export function refuseDownload(name: string, size: number): string {
  if (!/\.(xlsx|xls|csv)$/i.test(name.trim()))
    return `“${name}” Excel/CSV faylı deyil — yalnız e-qaimə ixracı qəbul olunur.`;
  if (size > MAX_DOWNLOAD) return `“${name}” 50 MB-dan böyükdür.`;
  return '';
}

/** The start page; a test may replace it only by a loopback origin. */
export function startUrl(testOrigin = ''): string {
  return testOrigin && LOOPBACK.test(testOrigin) ? `${testOrigin}/` : DVX_START;
}
