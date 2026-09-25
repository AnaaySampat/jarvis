/** Single source of truth for phone / touch layout (used by ViewportScale, IS_MOBILE, main.jsx). */
export const MOBILE_MAX_SHORT_SIDE = 640;

export function isMobileViewport() {
  if (typeof window === "undefined") return false;
  const coarse =
    typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
  const shortSide = Math.min(window.innerWidth, window.innerHeight);
  return coarse || shortSide <= MOBILE_MAX_SHORT_SIDE;
}
