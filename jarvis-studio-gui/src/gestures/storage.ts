export interface Bookmark {
  documentId: string;
  page: number;
  excerpt: string;
  at: number;
}
export function safeStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}
/** A compact document identity, not an authentication hash. Text stays in the
 * reader config once; bookmarks never duplicate entire documents. */
export function documentId(text: string): string {
  let a = 0x811c9dc5,
    b = 0x9e3779b9;
  for (let i = 0; i < text.length; i++) {
    const n = text.charCodeAt(i);
    a = Math.imul(a ^ n, 0x01000193);
    b = Math.imul(b ^ n, 0x85ebca6b);
  }
  return text.length.toString(36) + "-" + (a >>> 0).toString(16) + "-" + (b >>> 0).toString(16);
}
export function clampIndex(index: number, length: number): number {
  return Math.max(
    0,
    Math.min(Math.max(0, length - 1), Number.isFinite(index) ? Math.trunc(index) : 0),
  );
}
export function loadBookmarks(storage?: Pick<Storage, "getItem">): Bookmark[] {
  try {
    const raw = JSON.parse(storage?.getItem("jarvis.gesture.bookmarks.v2") || "[]");
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(
        (b) =>
          b &&
          typeof b.documentId === "string" &&
          b.documentId.length < 100 &&
          Number.isInteger(b.page) &&
          b.page >= 0 &&
          b.page < 1000 &&
          typeof b.excerpt === "string" &&
          Number.isFinite(b.at),
      )
      .slice(0, 50)
      .map((b) => ({
        documentId: b.documentId,
        page: b.page,
        excerpt: b.excerpt.slice(0, 120),
        at: b.at,
      }));
  } catch {
    return [];
  }
}
export function poseId(): string {
  try {
    if (typeof globalThis.crypto?.randomUUID === "function")
      return "custom_" + globalThis.crypto.randomUUID().replace(/-/g, "");
  } catch {
    /* Older/insecure WebViews still get a non-security identifier. */
  }
  return "custom_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 14);
}
