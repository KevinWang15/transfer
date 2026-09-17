// Run against an isolated local app and Chrome with remote debugging enabled.
// Node.js 22+ supplies the WebSocket client; no browser automation package needed.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";

const base = process.env.TRANSFER_BASE_URL || "http://127.0.0.1:16611";
const chrome = process.env.CDP_URL || "http://127.0.0.1:19222";
const artifacts =
  process.env.CDP_ARTIFACTS || "/tmp/transfer-message-deletion-cdp";
const sessionId = `delete-cdp-${Date.now()}`;
const clients = [];
const errors = [];
const checks = [];
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, label) {
  const deadline = Date.now() + 10000;
  do {
    if (await check()) return;
    await pause(50);
  } while (Date.now() < deadline);
  throw new Error(`Timed out: ${label}`);
}
function passed(label) {
  checks.push(label);
  console.log(`PASS ${label}`);
}

async function page() {
  const target = await fetch(`${chrome}/json/new?about:blank`, {
    method: "PUT",
  }).then((r) => r.json());
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  const handlers = new Map();
  socket.addEventListener("message", ({ data }) => {
    const packet = JSON.parse(data);
    if (packet.id) {
      const request = pending.get(packet.id);
      pending.delete(packet.id);
      if (packet.error) request.reject(new Error(JSON.stringify(packet.error)));
      else request.resolve(packet.result);
    } else {
      for (const handler of handlers.get(packet.method) || [])
        handler(packet.params);
    }
  });
  const client = {
    target,
    socket,
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++nextId;
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    on(method, handler) {
      handlers.set(method, [...(handlers.get(method) || []), handler]);
    },
    async evaluate(expression) {
      const result = await this.send("Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      assert.equal(
        result.exceptionDetails,
        undefined,
        JSON.stringify(result.exceptionDetails)
      );
      return result.result.value;
    },
    async click(selector) {
      await this.send("Page.bringToFront");
      const position = await this.evaluate(`(() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        if (!element) throw new Error('Missing click target');
        element.scrollIntoView({block: 'center'});
        const r = element.getBoundingClientRect();
        return {x: r.x + r.width / 2, y: r.y + r.height / 2};
      })()`);
      await this.send("Input.dispatchMouseEvent", {
        type: "mousePressed",
        button: "left",
        clickCount: 1,
        ...position,
      });
      await this.send("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        button: "left",
        clickCount: 1,
        ...position,
      });
    },
    async wait(expression, label = expression) {
      await until(() => this.evaluate(expression), label);
    },
    async navigate() {
      await this.send("Page.navigate", {
        url: `${base}/sessions/${sessionId}`,
      });
      await this.wait(
        "!!document.querySelector('textarea') && !document.querySelector('.session-loading')"
      );
    },
    async screenshot(name) {
      const result = await this.send("Page.captureScreenshot", {
        format: "png",
      });
      await fs.writeFile(
        `${artifacts}/${name}.png`,
        Buffer.from(result.data, "base64")
      );
    },
  };
  clients.push(client);
  client.on("Runtime.exceptionThrown", (event) =>
    errors.push(event.exceptionDetails)
  );
  await client.send("Runtime.enable");
  await client.send("Page.enable");
  await client.send("Network.enable");
  await client.send("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  return client;
}
async function sendText(text) {
  const form = new FormData();
  form.set("sessionId", sessionId);
  form.set("text", text);
  assert.equal(
    (await fetch(`${base}/text`, { method: "POST", body: form })).status,
    200
  );
}
async function upload(filename, contents) {
  const form = new FormData();
  form.set("sessionId", sessionId);
  form.set("file", new Blob([contents]), filename);
  return fetch(`${base}/file`, { method: "POST", body: form }).then((r) =>
    r.json()
  );
}
async function history() {
  return fetch(`${base}/sessions/${sessionId}/history`).then((r) => r.json());
}
async function remove(id) {
  assert.equal(
    (
      await fetch(`${base}/sessions/${sessionId}/messages/${id}`, {
        method: "DELETE",
      })
    ).status,
    200
  );
}
const count = (n) => `document.querySelectorAll('.message').length === ${n}`;
const confirm = ".feedback-dialog-actions .primary";
const cancel = ".feedback-dialog-actions .secondary";
const deleteFirst = ".message:first-of-type .message-delete-action";
let mcp;

try {
  await fs.mkdir(artifacts, { recursive: true });
  await sendText("Delete this text");
  await sendText("Keep this text");
  const file = await upload("delete-file.txt", "CDP file fixture");
  const image = await upload(
    "delete-image.png",
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=",
      "base64"
    )
  );
  const desktop = await page();
  const mobile = await page();
  await mobile.send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await mobile.send("Emulation.setTouchEmulationEnabled", { enabled: true });
  await Promise.all([desktop.navigate(), mobile.navigate()]);
  await Promise.all([desktop.wait(count(4)), mobile.wait(count(4))]);
  assert.equal(
    await desktop.evaluate(
      "document.querySelectorAll('.message-delete-action').length"
    ),
    4
  );
  await desktop.screenshot("desktop-before");
  await mobile.screenshot("mobile-before");

  await desktop.click(deleteFirst);
  await desktop.wait("!!document.querySelector('.feedback-dialog')");
  await desktop.wait("document.activeElement.textContent === 'Keep message'");
  await desktop.click(cancel);
  assert.equal((await history()).length, 4);
  passed("Cancel deletion preserves the message and focuses the safe action");

  await desktop.click(deleteFirst);
  await desktop.wait("!!document.querySelector('.feedback-dialog')");
  await desktop.click(confirm);
  await Promise.all([desktop.wait(count(3)), mobile.wait(count(3))]);
  assert.equal((await history()).length, 3);
  passed("UI text deletion updates desktop and mobile tabs in real time");

  // Intercept a DELETE with a real HTTP failure, then hold the retry in flight.
  let heldDelete;
  let failNext = true;
  desktop.on("Fetch.requestPaused", (event) => {
    if (event.request.method !== "DELETE") return;
    if (failNext) {
      failNext = false;
      void desktop.send("Fetch.fulfillRequest", {
        requestId: event.requestId,
        responseCode: 500,
        responseHeaders: [{ name: "Content-Type", value: "application/json" }],
        body: Buffer.from('{"error":"Injected test failure"}').toString(
          "base64"
        ),
      });
    } else heldDelete = event;
  });
  await desktop.send("Fetch.enable", {
    patterns: [{ urlPattern: "*/messages/*", requestStage: "Request" }],
  });
  await desktop.click(deleteFirst);
  await desktop.click(confirm);
  await desktop.wait(
    "document.body.textContent.includes('Could not delete the message')"
  );
  assert.equal((await history()).length, 3);
  await desktop.wait(
    "!document.querySelector('.message-delete-action').disabled"
  );
  passed("HTTP failure keeps the message visible and permits retry");
  await desktop.click(deleteFirst);
  await desktop.click(confirm);
  await until(() => heldDelete, "paused delete request");
  await desktop.wait(
    "document.querySelector('.message-delete-action').disabled"
  );
  assert.equal(
    await desktop.evaluate(
      "document.querySelector('.message-delete-action').textContent.includes('Deleting')"
    ),
    true
  );
  await desktop.send("Fetch.continueRequest", {
    requestId: heldDelete.requestId,
  });
  await Promise.all([desktop.wait(count(2)), mobile.wait(count(2))]);
  await desktop.send("Fetch.disable");
  passed("Pending deletion disables duplicate clicks; retry succeeds");

  await mobile.click(".message-file .message-delete-action");
  await mobile.wait(
    "document.querySelector('.feedback-dialog').textContent.includes('delete-file.txt')"
  );
  await mobile.screenshot("mobile-delete-confirmation");
  await mobile.click(confirm);
  await Promise.all([desktop.wait(count(1)), mobile.wait(count(1))]);
  assert.equal((await fetch(file.url)).status, 404);
  passed(
    "Mobile attachment deletion removes the download and preserves the other attachment"
  );

  // Activate the last message's delete button using the keyboard.
  await desktop.send("Page.bringToFront");
  await desktop.evaluate(
    "document.querySelector('.message-delete-action').focus()"
  );
  await desktop.send("Input.dispatchKeyEvent", {
    type: "keyDown",
    text: "\r",
    key: "Enter",
    code: "Enter",
    windowsVirtualKeyCode: 13,
  });
  await desktop.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Enter",
    code: "Enter",
    windowsVirtualKeyCode: 13,
  });
  await desktop.wait("!!document.querySelector('.feedback-dialog')");
  await desktop.click(confirm);
  await Promise.all([desktop.wait(count(0)), mobile.wait(count(0))]);
  await desktop.wait("!!document.querySelector('.session-empty-state')");
  assert.equal((await fetch(image.url)).status, 404);
  passed(
    "Keyboard deletion of an image removes its attachment and shows the empty state"
  );

  await sendText("MCP removes me");
  await Promise.all([desktop.wait(count(1)), mobile.wait(count(1))]);
  mcp = new Client({ name: "transfer-cdp-test", version: "1.0.0" });
  await mcp.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
  const messageId = (await history())[0].id;
  const deleted = await mcp.callTool({
    name: "delete_message",
    arguments: { sessionId, messageId },
  });
  assert.equal(deleted.structuredContent.success, true);
  await Promise.all([desktop.wait(count(0)), mobile.wait(count(0))]);
  passed("MCP deletion updates connected browser tabs");

  // Hold a stale history response while a deletion notification arrives.
  await sendText("Stale history must not restore me");
  await mobile.wait(count(1));
  const staleId = (await history())[0].id;
  let heldHistory;
  mobile.on("Fetch.requestPaused", (event) => {
    heldHistory = event;
  });
  await mobile.send("Fetch.enable", {
    patterns: [{ urlPattern: "*/history", requestStage: "Response" }],
  });
  await mobile.send("Page.reload");
  await until(() => heldHistory, "paused history response");
  await mobile.wait("document.body.textContent.includes('Connected')");
  const staleBody = await mobile.send("Fetch.getResponseBody", {
    requestId: heldHistory.requestId,
  });
  assert.ok(
    (staleBody.base64Encoded
      ? Buffer.from(staleBody.body, "base64").toString()
      : staleBody.body
    ).includes(String(staleId))
  );
  await remove(staleId);
  await desktop.wait(count(0));
  await pause(150);
  await mobile.send("Fetch.fulfillRequest", {
    requestId: heldHistory.requestId,
    responseCode: 200,
    responseHeaders: [{ name: "Content-Type", value: "application/json" }],
    body: staleBody.base64Encoded
      ? staleBody.body
      : Buffer.from(staleBody.body).toString("base64"),
  });
  await mobile.send("Fetch.disable");
  await mobile.wait("!!document.querySelector('.session-empty-state')");
  passed(
    "A delayed history response cannot restore a message deleted through the API"
  );

  // Pending browser sends have no retained ID and must not expose Delete.
  let heldText;
  mobile.on("Fetch.requestPaused", (event) => {
    if (event.request.url.endsWith("/t")) heldText = event;
  });
  await mobile.send("Fetch.enable", {
    patterns: [{ urlPattern: "*/t", requestStage: "Request" }],
  });
  await mobile.click("textarea");
  await mobile.send("Input.insertText", { text: "Pending browser message" });
  await mobile.click('[aria-label="Send message"]');
  await until(() => heldText, "paused text send");
  await mobile.wait("!!document.querySelector('.delivery-sending')");
  assert.equal(
    await mobile.evaluate(
      "document.querySelectorAll('.message-delete-action').length"
    ),
    0
  );
  await mobile.send("Fetch.continueRequest", { requestId: heldText.requestId });
  await mobile.send("Fetch.disable");
  await mobile.wait("!!document.querySelector('.message-delete-action')");
  await desktop.wait(count(1));
  passed("Pending messages expose Delete only after server confirmation");

  // A stale tab can still remove a message already deleted by another client.
  const lastId = (await history())[0].id;
  await mobile.click(deleteFirst);
  await remove(lastId);
  await mobile.click(confirm);
  await mobile.wait("document.body.textContent.includes('Message deleted.')");
  await mobile.wait(count(0));
  await desktop.send("Page.reload");
  await desktop.wait("!!document.querySelector('.session-empty-state')");
  passed(
    "Concurrent deletion is handled gracefully and remains deleted after reload"
  );
  assert.equal(
    await mobile.evaluate(
      "document.documentElement.scrollWidth <= window.innerWidth"
    ),
    true
  );
  assert.deepEqual(errors, []);
  await desktop.screenshot("desktop-empty");
  await mobile.screenshot("mobile-empty");
  passed("No uncaught browser exceptions or horizontal overflow on mobile");
  await fs.writeFile(
    `${artifacts}/results.json`,
    JSON.stringify({ checks, errors }, null, 2)
  );
  console.log(
    `${checks.length} browser checks passed. Artifacts: ${artifacts}`
  );
} catch (error) {
  for (const [index, client] of clients.entries()) {
    await client.screenshot(`failure-${index}`).catch(() => {});
    console.error(
      await client
        .evaluate(
          "JSON.stringify({active: document.activeElement.outerHTML, text: document.body.innerText})"
        )
        .catch(() => "Page unavailable")
    );
  }
  throw error;
} finally {
  await mcp?.close();
  for (const client of clients) {
    client.socket.close();
    await fetch(`${chrome}/json/close/${client.target.id}`).catch(() => {});
  }
  await fetch(`${base}/sessions/${sessionId}/history`, {
    method: "DELETE",
  }).catch(() => {});
}
