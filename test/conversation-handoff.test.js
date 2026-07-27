import assert from "node:assert/strict";
import { test } from "node:test";

import {
  conversationHandoffModality,
  createConversationHandoffParams,
} from "../plugins/gitright/widget/conversation-handoff.ts";

const selectedSha = "a".repeat(40);

test("conversation handoff requires an advertised supported context modality", () => {
  assert.equal(conversationHandoffModality(null), null);
  assert.equal(conversationHandoffModality({}), null);
  assert.equal(conversationHandoffModality({ updateModelContext: {} }), null);
  assert.equal(
    conversationHandoffModality({ updateModelContext: { text: {} } }),
    "text",
  );
  assert.equal(
    conversationHandoffModality({ updateModelContext: { structuredContent: {} } }),
    "structuredContent",
  );
  assert.equal(
    conversationHandoffModality({
      updateModelContext: { text: {}, structuredContent: {} },
    }),
    "text",
  );
});

test("text handoff contains the selected full SHA as its only datum", () => {
  assert.deepEqual(createConversationHandoffParams(selectedSha, "text"), {
    content: [{ type: "text", text: selectedSha }],
  });
});

test("structured handoff contains only one selected SHA field", () => {
  assert.deepEqual(createConversationHandoffParams(selectedSha, "structuredContent"), {
    structuredContent: { selectedSha },
  });
});

test("conversation handoff rejects anything except one lowercase full SHA", () => {
  for (const invalid of [
    "a".repeat(39),
    "a".repeat(41),
    "A".repeat(40),
    "not-a-sha",
    `${selectedSha}\nmessage`,
  ]) {
    assert.throws(
      () => createConversationHandoffParams(invalid, "text"),
      /full commit SHA/,
    );
  }
});
