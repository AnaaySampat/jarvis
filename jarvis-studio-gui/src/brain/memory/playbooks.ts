/**
 * Compatibility façade for verified procedural learning v2.
 *
 * Existing add/list/remove/describe callers remain stable, but raw prose is only
 * a disabled reference. Typed workflow registration and trusted verification
 * receipts live in the same exported API and are intentionally not model tools.
 */

export * from "./proceduralLearning";
