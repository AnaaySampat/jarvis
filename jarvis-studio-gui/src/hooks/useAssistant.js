/* useAssistant — ANDROID FORK
 *
 * Picks the data source for the HUD: the in-app TypeScript brain on Android and in
 * this fork’s browser preview, or the
 * Python-backend WebSocket in a native desktop build. The choice is made ONCE at module load (the
 * platform can't change mid-session), so `useAssistant` is a stable reference to a
 * single hook — calling it every render satisfies the rules of hooks (no conditional
 * hook calls). App.jsx imports this instead of useWebSocket. */

import { useWebSocket } from "./useWebSocket";
import { useBrain } from "./useBrain";
import { usesLocalAssistant } from "../utils/assistantRuntime";

export const IS_MOBILE = usesLocalAssistant();

export const useAssistant = IS_MOBILE ? useBrain : useWebSocket;
