/**
 * "A new version is available." Asks GitHub for the latest release at most once a day and
 * reports it when it's newer than the installed APK. Notify-only: installing an APK the
 * app downloaded itself would need REQUEST_INSTALL_PACKAGES, so the user gets the release
 * page and installs it the way they installed this one.
 */

import { getJson } from "../tools/httpClient";

export const RELEASES_URL = "https://github.com/AnaaySampat/jarvis/releases/latest";
const LATEST_API = "https://api.github.com/repos/AnaaySampat/jarvis/releases/latest";
const CHECKED_KEY = "jarvis.update.checkedAt";
const DAY_MS = 24 * 60 * 60 * 1000;

/** True when release tag `latest` ("v2.1.0") is a higher x.y.z than `current`. */
export function isNewer(latest: string, current: string): boolean {
  const parse = (v: string) =>
    v
      .replace(/^v/i, "")
      .split(/[.-]/)
      .slice(0, 3)
      .map((n) => parseInt(n, 10) || 0);
  const [a, b] = [parse(latest), parse(current)];
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

/** The newer release, or null (up to date, checked within a day, or the check failed —
 *  an update notice is never worth an error). */
export async function checkForUpdate(
  current: string,
  now = Date.now(),
): Promise<{ version: string; url: string } | null> {
  try {
    const last = Number(localStorage.getItem(CHECKED_KEY) || 0);
    if (now - last < DAY_MS) return null;
    localStorage.setItem(CHECKED_KEY, String(now));
  } catch {
    // no storage: check every launch
  }
  try {
    const rel = await getJson<{
      tag_name?: string;
      html_url?: string;
      draft?: boolean;
      prerelease?: boolean;
    }>(LATEST_API, { headers: { Accept: "application/vnd.github+json" }, timeoutMs: 10000 });
    const tag = rel.tag_name ?? "";
    if (!tag || rel.draft || rel.prerelease || !isNewer(tag, current)) return null;
    return { version: tag.replace(/^v/i, ""), url: rel.html_url || RELEASES_URL };
  } catch {
    return null;
  }
}
