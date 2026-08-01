import { createInterface } from "node:readline";

export function createMcpClient({
  input,
  output,
  closedError,
  rejectPendingOnInvalidJson = true,
}) {
  const pending = new Map();
  let nextId = 0;
  const lines = createInterface({ input, crlfDelay: Infinity });

  function rejectPending(error) {
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
  }

  lines.on("line", (line) => {
    let response;
    try {
      response = JSON.parse(line);
    } catch (error) {
      if (!rejectPendingOnInvalidJson) throw error;
      rejectPending(error);
      return;
    }
    const waiter = pending.get(response.id);
    if (!waiter) return;
    pending.delete(response.id);
    waiter.resolve(response);
  });

  function write(message) {
    output.write(`${JSON.stringify(message)}\n`);
  }

  function sendRequest(message) {
    return new Promise((resolve, reject) => {
      if (pending.has(message.id)) {
        reject(new Error(`duplicate request id: ${message.id}`));
        return;
      }
      pending.set(message.id, { resolve, reject });
      write(message);
    });
  }

  function request(method, params = {}) {
    const id = ++nextId;
    return sendRequest({ jsonrpc: "2.0", id, method, params });
  }

  function notify(method, params = {}) {
    write({ jsonrpc: "2.0", method, params });
  }

  function processClosed(result) {
    rejectPending(closedError(result));
  }

  return { sendRequest, request, notify, processClosed };
}
