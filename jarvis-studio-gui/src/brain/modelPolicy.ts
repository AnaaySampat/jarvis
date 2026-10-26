/**
 * Human-friendly model strength labels plus the lightweight request classifier
 * used by Auto mode. These are deliberately conservative: a weak model only
 * receives greetings and other throwaway turns; anything useful remains smart.
 */

export type ModelClass = "dumb" | "smart" | "very-smart" | "image";
export type ChatModelClass = Exclude<ModelClass, "image">;

/** Classify a model id without relying on provider-specific display names. */
export function modelClassFor(modelId: string): ModelClass {
  const id = (modelId ?? "").trim().toLowerCase();
  if (/(?:^|[-_/])(?:image|imagen)(?:$|[-_/])/.test(id)) return "image";
  if (/(?:^|[-_/])(?:lite|mini|small|1b|2b|3b|4b|7b|8b|20b)(?:$|[-_/])/.test(id)) {
    return "dumb";
  }
  if (
    /(?:^|[-_/])(?:pro|120b|70b|72b|405b|235b|r1)(?:$|[-_/])/.test(id) ||
    /gemini[-_.]?3(?:[._-]|$)/.test(id)
  ) {
    return "very-smart";
  }
  return "smart";
}

/** Pick an Auto strength for the user's actual request, not merely its length. */
export function taskModelClass(text: string): ChatModelClass {
  const request = (text ?? "").trim().toLowerCase();
  if (!request) return "smart";

  if (
    request.length > 700 ||
    /\b(?:analy[sz]e|analysis|compare|evaluate|debug|diagnos|architect|strategy|research|plan|design|implement|build|refactor|prove|derive|solve|review|long[- ]form|step[- ]by[- ]step)\b/.test(
      request,
    )
  ) {
    return "very-smart";
  }

  if (
    /^(?:hi|hello|hey|thanks|thank you|good (?:morning|afternoon|evening)|who are you|are you there|bye)[!?.\s]*$/.test(
      request,
    )
  ) {
    return "dumb";
  }

  return "smart";
}

/** A second completion model is useful for synthesis or several requirements,
 * not for checking a single tool's receipt. Actual multi-tool turns also qualify
 * in the turn loop, even if their original wording looked simple. */
export function isComplexTask(text: string): boolean {
  if (taskModelClass(text) === "very-smart") return true;
  const action =
    "(?:open|close|launch|start|stop|play|pause|resume|set|turn|mute|unmute|" +
    "search|find|read|check|inspect|return|go|send|email|share|forward|save|" +
    "write|create|make|delete|move|copy|download|upload|install|" +
    "summarize|summarise|translate|remind|schedule|call|text|message|add|remove)";
  return new RegExp(
    "(?:\\b(?:and(?:\\s+then)?|then|also|afterwards|next)\\s+|[;\\n]\\s*|[.!?]\\s+)(?:please\\s+)?" +
      action +
      "\\b|\\b(?:first|second|finally)\\s+" +
      action +
      "\\b",
    "i",
  ).test(text);
}

/**
 * True only for a request to CREATE or show a new image. Questions about image
 * technology, editing tutorials, or a description of an existing image remain
 * normal chat turns.
 */
export function isImageGenerationRequest(text: string): boolean {
  const request = (text ?? "").trim().toLowerCase();
  if (!request) return false;

  // "How do I create a logo in Photoshop?" needs an explanation, not an image.
  if (
    /^(?:how|what|why|when|where|which|who)\b|\b(?:tutorial|instructions|prompt engineering)\b/.test(
      request,
    )
  ) {
    return false;
  }

  const noun =
    "(?:image|picture|photo|drawing|illustration|wallpaper|logo|avatar|portrait|artwork|sketch|icon|meme|sticker)";
  const verb = "(?:generate|create|make|draw|paint|illustrate|render|design|produce|craft)";
  return (
    new RegExp("\\b" + verb + "\\b[\\s\\S]{0,80}\\b" + noun + "\\b", "i").test(request) ||
    new RegExp(
      "\\b(?:i want|i would like|i'd like|give me|show me|need)\\b[\\s\\S]{0,40}\\b" + noun + "\\b",
      "i",
    ).test(request) ||
    /^(?:please\s+)?(?:draw|paint|illustrate|render)\b/i.test(request) ||
    /\bshow\s+(?:me\s+)?(?:what\s+)?[\s\S]{1,80}\slooks?\s+like\b/i.test(request)
  );
}
/** A single local-weather lookup can use the tool's complete, readable answer.
 * Deliberately excludes other cities, advice, comparisons and combined actions. */
export function isDirectWeatherRequest(text: string): boolean {
  const request = text
    .trim()
    .replace(/^(?:hey\s+)?jarvis[,.:]?\s+/i, "")
    .replace(/^please\s+/i, "")
    .replace(/[?!.,\s]+$/g, "");
  return /^(?:(?:what(?:'s|’s| is)|how(?:'s|’s| is))\s+(?:the\s+)?(?:current\s+|local\s+)?weather(?:\s+like)?|(?:(?:can|could|would)\s+you\s+)?(?:tell|show|give)(?:\s+me)?\s+(?:the\s+)?(?:current\s+|local\s+)?weather(?:\s+forecast)?|(?:current\s+|local\s+)?weather(?:\s+forecast)?)(?:\s+(?:here|outside|today|tomorrow|now|right now|for today|for tomorrow|in my area|near me)){0,3}$/i.test(
    request,
  );
}

/** A plain request to read the local notification list needs the reader, not a
 * model deciding whether it has access. Filters/compound actions keep full routing. */
export function isDirectNotificationRequest(text: string): boolean {
  const request = text
    .trim()
    .replace(/^(?:hey\s+)?jarvis[,.:]?\s+/i, "")
    .replace(/[?!.,\s]+$/g, "");
  return /^(?:(?:can|could|would)\s+you\s+)?(?:please\s+)?(?:read|show|list|check)(?:\s+(?:out loud|aloud))?(?:\s+me)?\s+(?:(?:all(?:\s+of)?\s+)?(?:my|the)\s+)?(?:(?:new|unread|current)\s+)?notifications?(?:\s+(?:aloud|out loud|for me|please))?(?:\s+and\s+tell\s+me\s+(?:what\s+they\s+are|what\s+they\s+say|their\s+contents?))?$/i.test(
    request,
  );
}
