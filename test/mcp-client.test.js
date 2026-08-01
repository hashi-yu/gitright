import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { test } from "node:test";

import { createMcpClient } from "../test-support/mcp-client.js";

function createFixture() {
  const input = new PassThrough();
  const output = new PassThrough();
  const writes = [];
  output.setEncoding("utf8");
  output.on("data", (chunk) => writes.push(chunk));
  const client = createMcpClient({
    input,
    output,
    closedError: ({ code, signal }) =>
      new Error(`test MCP closed (code=${code}, signal=${signal})`),
  });
  return { client, input, writes };
}

test("matches out-of-order responses and writes requests and notifications", async () => {
  const fixture = createFixture();
  const first = fixture.client.request("first", { value: 1 });
  const second = fixture.client.request("second");
  fixture.client.notify("ready", { enabled: true });

  assert.deepEqual(fixture.writes.map((line) => JSON.parse(line)), [
    { jsonrpc: "2.0", id: 1, method: "first", params: { value: 1 } },
    { jsonrpc: "2.0", id: 2, method: "second", params: {} },
    { jsonrpc: "2.0", method: "ready", params: { enabled: true } },
  ]);

  fixture.input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, result: "two" })}\n`);
  fixture.input.write(`${JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    error: { code: -32000, message: "one failed" },
  })}\n`);

  assert.deepEqual(await second, { jsonrpc: "2.0", id: 2, result: "two" });
  assert.deepEqual(await first, {
    jsonrpc: "2.0",
    id: 1,
    error: { code: -32000, message: "one failed" },
  });
});

test("supports explicit request IDs and rejects duplicates", async () => {
  const fixture = createFixture();
  const request = fixture.client.sendRequest({
    jsonrpc: "2.0",
    id: 7,
    method: "explicit",
    params: {},
  });

  await assert.rejects(
    fixture.client.sendRequest({ jsonrpc: "2.0", id: 7, method: "duplicate" }),
    /duplicate request id: 7/,
  );
  fixture.input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 7, result: true })}\n`);
  assert.equal((await request).result, true);
});

test("rejects every pending waiter when the process closes", async () => {
  const fixture = createFixture();
  const first = fixture.client.request("first");
  const second = fixture.client.request("second");

  fixture.client.processClosed({ code: 9, signal: null });

  await assert.rejects(first, /test MCP closed \(code=9, signal=null\)/);
  await assert.rejects(second, /test MCP closed \(code=9, signal=null\)/);
});
