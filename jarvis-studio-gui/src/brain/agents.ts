/**
 * The agent row (the desktop's agents.py, in the part that fits a phone).
 *
 * Auto is the ordinary turn: one model with the whole palette, which can already hand
 * a job to the PC (pc_task). Picking an agent — on the row, by "@files …" anywhere in a
 * request, or a spoken "tell the research agent to …" — narrows that:
 *
 * - Phone, Files, Scheduler, Content: a phone turn with that agent's tool groups always
 *   loaded and its brief in the system prompt (the rest stay one load_tools away).
 * - Desktop, Browser: the whole request goes to that agent on the paired PC, as a
 *   pc_task through dispatch like any other (fingerprint first, as always).
 * - Research: the PC's research agent — a headless browser reading several sites — when
 *   a PC is paired; otherwise a phone turn that works through web searches.
 *
 * The desktop's coordinator (plans across agents, hand-offs) runs on the PC; on the
 * phone, Auto's tool loop already chains tools across what a phone can do.
 */

export type AgentId =
  "auto" | "phone" | "research" | "files" | "scheduling" | "content" | "desktop" | "browser";

export interface AgentDef {
  id: AgentId;
  name: string;
  /** What "@handle" picks it. */
  handle: string;
  color: string;
  hint: string;
  /** Runs on the paired PC as this pc_task kind. */
  pc?: "computer" | "browser" | "research";
  /** A phone turn: tool groups always loaded, and its brief. */
  groups?: string[];
  brief?: string;
}

export const AGENTS: readonly AgentDef[] = [
  {
    id: "auto",
    name: "Auto",
    handle: "auto",
    color: "var(--accent, #00e5ff)",
    hint: "JARVIS picks the tools for each request",
  },
  {
    id: "phone",
    name: "Phone",
    handle: "phone",
    color: "#ffd166",
    hint: "This phone's apps, switches, messages and calls",
    brief:
      "AGENT: PHONE\nYou are JARVIS's Phone agent: you work on this phone — its apps, switches, messages and calls. Use the one-step phone tools first and phone_task for the rest.",
  },
  {
    id: "research",
    name: "Research",
    handle: "research",
    color: "#a07cff",
    hint: "Reads several sites (on your PC's background browser when it's paired) and reports with sources",
    pc: "research",
    brief:
      "AGENT: RESEARCH\nYou are JARVIS's Research agent. Look the topic up from several angles with web_search (at least three searches), compare what the sources say, and answer with the key findings, naming the source of each.",
  },
  {
    id: "files",
    name: "Files",
    handle: "files",
    color: "#3ecf8e",
    hint: "Lists, reads and summarises files on this phone",
    groups: ["files"],
    brief:
      "AGENT: FILES\nYou are JARVIS's Files agent: you work in the user's files. To go through a folder, list it first, then read every file that matters — never describe a file you didn't read. A summary names each file.",
  },
  {
    id: "scheduling",
    name: "Scheduler",
    handle: "scheduler",
    color: "#ff6fa8",
    hint: "Alarms, timers, reminders, the agenda, routines",
    groups: ["planner"],
    brief:
      "AGENT: SCHEDULER\nYou are JARVIS's Scheduling agent: alarms, timers, reminders, the agenda and routines. Turn the times the user gives into exact ones, check the agenda before adding something that could clash, and confirm what you set in one sentence.",
  },
  {
    id: "content",
    name: "Content",
    handle: "content",
    color: "#ff8f4c",
    hint: "Writes posts, messages and documents; makes images",
    groups: ["media"],
    brief:
      "AGENT: CONTENT\nYou are JARVIS's Content agent: you write — posts, messages, summaries, documents — and make images. Match the tone asked for and give the finished piece itself, not a description of it.",
  },
  {
    id: "desktop",
    name: "Desktop",
    handle: "desktop",
    color: "#f5a524",
    hint: "Windows apps on your PC",
    pc: "computer",
  },
  {
    id: "browser",
    name: "Browser",
    handle: "browser",
    color: "#5b8cff",
    hint: "Websites in your PC's Chrome, where you're signed in",
    pc: "browser",
  },
];

const BY_ID = new Map(AGENTS.map((a) => [a.id, a]));

const ALIASES: Record<string, AgentId> = {
  auto: "auto",
  phone: "phone",
  mobile: "phone",
  research: "research",
  researcher: "research",
  files: "files",
  file: "files",
  scheduler: "scheduling",
  scheduling: "scheduling",
  schedule: "scheduling",
  calendar: "scheduling",
  content: "content",
  writer: "content",
  writing: "content",
  desktop: "desktop",
  computer: "desktop",
  pc: "desktop",
  browser: "browser",
  web: "browser",
  chrome: "browser",
};

export function agentById(id: string | undefined): AgentDef {
  return BY_ID.get((id ?? "auto") as AgentId) ?? AGENTS[0]!;
}

/** The agents the row shows: the PC's only while one is paired. */
export function agentsFor(pcPaired: boolean): AgentDef[] {
  return AGENTS.filter((a) => pcPaired || a.pc === undefined || a.id === "research");
}

const AT = /(?:^|\s)@([a-z]+)\b[,:]?/i; // whitespace first: not inside an address
const SPOKEN =
  /^\s*(?:(?:ask|tell|use|get) (?:the |my |your )?)?([a-z]+) agent\b(?:\s*[,:]|\s+to\b)?\s*/i;

/** The agent a request names, and the request without the name; "" when none. */
export function mention(text: string): { agent: AgentId | ""; rest: string } {
  const t = text ?? "";
  const at = AT.exec(t);
  const byAt = at ? ALIASES[at[1]!.toLowerCase()] : undefined;
  if (at && byAt) {
    const rest = (t.slice(0, at.index) + " " + t.slice(at.index + at[0].length))
      .split(/\s+/)
      .filter(Boolean)
      .join(" ");
    return rest ? { agent: byAt, rest } : { agent: "", rest: t };
  }
  const spoken = SPOKEN.exec(t);
  const bySpoken = spoken ? ALIASES[spoken[1]!.toLowerCase()] : undefined;
  const after = spoken ? t.slice(spoken[0].length).trim() : "";
  if (bySpoken && after) return { agent: bySpoken, rest: after };
  return { agent: "", rest: t };
}

/** How a picked agent runs a request: on the PC, as a scoped phone turn, or (null) as
 *  the ordinary turn. */
export function routeFor(
  id: AgentId | "",
  pcPaired: boolean,
): { pc: "computer" | "browser" | "research" } | { groups: string[]; context: string } | null {
  const a = agentById(id || "auto");
  if (a.pc && (pcPaired || a.pc !== "research")) return { pc: a.pc };
  if (a.brief) return { groups: a.groups ?? [], context: a.brief };
  return null;
}
