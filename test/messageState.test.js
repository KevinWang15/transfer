import assert from "node:assert/strict";
import test from "node:test";

import {
  createPendingTextMessage,
  DELIVERY_STATUS,
  reconcileIncomingMessage,
  reconcileMessageHistory,
  removeLocalMessage,
  updateLocalDeliveryStatus,
} from "../src/utils/messageState.js";

function pendingMessage(overrides = {}) {
  return createPendingTextMessage({
    text: "Ship it",
    sessionId: "ux-test",
    clientId: "client-message-1",
    createdAt: 1234,
    ...overrides,
  });
}

function confirmedMessage(overrides = {}) {
  return {
    id: 42,
    session_id: "ux-test",
    client_id: "client-message-1",
    created_at: 1234,
    data: { type: "text", text: "Ship it" },
    ...overrides,
  };
}

test("a text message appears immediately with a sending state", () => {
  const message = pendingMessage();
  assert.equal(message.id, "local-client-message-1");
  assert.equal(message.deliveryStatus, DELIVERY_STATUS.sending);
  assert.equal(message.data.text, "Ship it");
});

test("a server event replaces its optimistic message without a duplicate", () => {
  const reconciled = reconcileIncomingMessage(
    [pendingMessage()],
    confirmedMessage()
  );
  assert.deepEqual(reconciled, [confirmedMessage()]);

  const duplicateEvent = reconcileIncomingMessage(
    reconciled,
    confirmedMessage()
  );
  assert.deepEqual(duplicateEvent, [confirmedMessage()]);
});

test("history reconciliation keeps only local messages not yet confirmed", () => {
  const otherPending = pendingMessage({ clientId: "client-message-2" });
  const reconciled = reconcileMessageHistory(
    [pendingMessage(), otherPending],
    [confirmedMessage()]
  );

  assert.equal(reconciled.length, 2);
  assert.equal(reconciled[0].id, 42);
  assert.equal(reconciled[1].client_id, "client-message-2");
});

test("a socket confirmation that arrives during history loading is preserved", () => {
  const initialPending = pendingMessage();
  const reconciled = reconcileMessageHistory(
    [confirmedMessage()],
    [],
    [initialPending]
  );

  assert.deepEqual(reconciled, [confirmedMessage()]);
});

test("delivery updates and removal affect local messages only", () => {
  const sent = updateLocalDeliveryStatus(
    [pendingMessage(), confirmedMessage()],
    "client-message-1",
    DELIVERY_STATUS.sent
  );
  assert.equal(sent[0].deliveryStatus, DELIVERY_STATUS.sent);
  assert.equal(sent[1].deliveryStatus, undefined);

  assert.deepEqual(removeLocalMessage(sent, "client-message-1"), [
    confirmedMessage(),
  ]);
});
