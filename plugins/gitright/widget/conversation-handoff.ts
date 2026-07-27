export type ConversationHandoffModality = "text" | "structuredContent";

export type ConversationHandoffParams =
  | { content: [{ type: "text"; text: string }] }
  | { structuredContent: { selectedSha: string } };

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function advertised(value: unknown): boolean {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function conversationHandoffModality(
  hostCapabilities: unknown,
): ConversationHandoffModality | null {
  const updateModelContext = record(record(hostCapabilities).updateModelContext);
  if (advertised(updateModelContext.text)) return "text";
  if (advertised(updateModelContext.structuredContent)) return "structuredContent";
  return null;
}

export function createConversationHandoffParams(
  selectedSha: string,
  modality: ConversationHandoffModality,
): ConversationHandoffParams {
  if (!/^[0-9a-f]{40}$/.test(selectedSha)) {
    throw new TypeError("conversation handoff requires one lowercase full commit SHA");
  }
  return modality === "text"
    ? { content: [{ type: "text", text: selectedSha }] }
    : { structuredContent: { selectedSha } };
}
