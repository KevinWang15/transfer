export const DELIVERY_STATUS = Object.freeze({
  sending: "sending",
  sent: "sent",
  failed: "failed",
});

function fallbackClientId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex
    .slice(6, 8)
    .join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

export function createClientMessageId() {
  return crypto.randomUUID ? crypto.randomUUID() : fallbackClientId();
}

export function createPendingTextMessage({
  text,
  sessionId,
  clientId = createClientMessageId(),
  createdAt = Date.now(),
}) {
  return {
    id: `local-${clientId}`,
    client_id: clientId,
    session_id: sessionId,
    created_at: createdAt,
    deliveryStatus: DELIVERY_STATUS.sending,
    data: {
      type: "text",
      text,
    },
  };
}

export function messagesMatch(left, right) {
  if (left.id != null && right.id != null && left.id === right.id) {
    return true;
  }

  return Boolean(
    left.client_id && right.client_id && left.client_id === right.client_id
  );
}

export function reconcileIncomingMessage(messages, incomingMessage) {
  const index = messages.findIndex((message) =>
    messagesMatch(message, incomingMessage)
  );
  if (index === -1) {
    return [...messages, incomingMessage];
  }

  const nextMessages = [...messages];
  nextMessages[index] = incomingMessage;
  return nextMessages;
}

export function reconcileMessageHistory(
  messages,
  history,
  messagesAtRequest = messages
) {
  const messagesToPreserve = messages.filter((message) => {
    const messageAtRequest = messagesAtRequest.find((candidate) =>
      messagesMatch(candidate, message)
    );
    return (
      message.deliveryStatus ||
      !messageAtRequest ||
      messageAtRequest.deliveryStatus
    );
  });

  return messagesToPreserve.reduce(
    (merged, message) => {
      if (merged.some((candidate) => messagesMatch(candidate, message))) {
        return merged;
      }
      return [...merged, message];
    },
    [...history]
  );
}

export function updateLocalDeliveryStatus(messages, clientId, status) {
  return messages.map((message) =>
    message.client_id === clientId && message.deliveryStatus
      ? { ...message, deliveryStatus: status }
      : message
  );
}

export function removeLocalMessage(messages, clientId) {
  return messages.filter(
    (message) =>
      message.client_id !== clientId || message.deliveryStatus == null
  );
}
