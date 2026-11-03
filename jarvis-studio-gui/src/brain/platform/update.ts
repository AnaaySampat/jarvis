/**
 * "A new version is available." Asks GitHub for the latest release at most once a day and
 * reports it when it's newer than the installed APK. Notify-only: installing an APK the
 * app downloaded itself would need REQUEST_INSTALL_PACKAGES, so the user gets the release
 * page and installs it the way they installed this one.
 */

import { getJson } from "../tools/httpClient";

export const RELEASES_URL = "https://github.com/AnaaySampat/jarvis/releases/latest";
const LATEST_API = "https://api.github.com/repos/AnaaySampat/jarvis/releases/latest";
const RELEASES_API = "https://api.github.com/repos/AnaaySampat/jarvis/releases?per_page=20";
export type UpdateChannel = "stable" | "beta";
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
  const latestPre = latest.replace(/^v/i, "").split("+")[0].split("-").slice(1).join("-");
  const currentPre = current.replace(/^v/i, "").split("+")[0].split("-").slice(1).join("-");
  if (!latestPre || !currentPre) return !latestPre && !!currentPre;
  const left = latestPre.split(".");
  const right = currentPre.split(".");
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    if (left[i] === undefined || right[i] === undefined) return left.length > right.length;
    if (left[i] === right[i]) continue;
    const numericLeft = /^\d+$/.test(left[i]);
    const numericRight = /^\d+$/.test(right[i]);
    if (numericLeft && numericRight) return Number(left[i]) > Number(right[i]);
    if (numericLeft !== numericRight) return !numericLeft;
    return left[i] > right[i];
  }
  return false;
}

/** The newer release, or null (up to date, checked within a day, or the check failed —
 *  an update notice is never worth an error). */
export async function checkForUpdate(
  current: string,
  now = Date.now(),
  channel: UpdateChannel = "stable",
): Promise<{ version: string; url: string } | null> {
  try {
    const checkedKey = channel === "beta" ? `${CHECKED_KEY}.beta` : CHECKED_KEY;
    const last = Number(localStorage.getItem(checkedKey) || 0);
    if (now - last < DAY_MS) return null;
    localStorage.setItem(checkedKey, String(now));
  } catch {
    // no storage: check every launch
  }
  try {
    type Release = {
      tag_name?: string;
      html_url?: string;
      draft?: boolean;
      prerelease?: boolean;
    };
    const response = await getJson<Release | Release[]>(
      channel === "beta" ? RELEASES_API : LATEST_API,
      { headers: { Accept: "application/vnd.github+json" }, timeoutMs: 10000 },
    );
    const candidates = (Array.isArray(response) ? response : [response]).filter(
      (release) => !release.draft && (channel === "beta" || !release.prerelease),
    );
    const rel = candidates.sort((left, right) =>
      isNewer(left.tag_name || "", right.tag_name || "")
        ? -1
        : isNewer(right.tag_name || "", left.tag_name || "")
          ? 1
          : 0,
    )[0];
    if (!rel) return null;
    const tag = rel.tag_name ?? "";
    if (!tag || !isNewer(tag, current)) return null;
    return { version: tag.replace(/^v/i, ""), url: rel.html_url || RELEASES_URL };
  } catch {
    return null;
  }
}
