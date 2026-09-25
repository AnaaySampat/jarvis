/* useAssistant — ANDROID FORK
 *
 * Picks the data source for the HUD: the in-app TypeScript brain on a phone, or the
 * Python-backend WebSocket on desktop. The choice is made ONCE at module load (the
 * platform can't change mid-session), so `useAssistant` is a stable reference to a
 * single hook — calling it every render satisfies the rules of hooks (no conditional
 * hook calls). App.jsx imports this instead of useWebSocket. */

import { useWebSocket } from "./useWebSocket";
import { useBrain } from "./useBrain";
import { isMobileViewport } from "../utils/isMobileViewport";

export const IS_MOBILE = isMobileViewport();

export const useAssistant = IS_MOBILE ? useBrain : useWebSocket;
