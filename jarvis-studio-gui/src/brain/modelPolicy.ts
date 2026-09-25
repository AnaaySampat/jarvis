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
