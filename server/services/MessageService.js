import fs from "fs";
import { db } from "../database.js";
import Message from "../models/message.js";
import config from "../config.js";
import { NEW_MESSAGE } from "@transfer/api/consts/socketEvents.js";

function calcMessagesToDelete(messages) {
  const byMaxCount = messages.length - config.messagesToKeep.maxCount;
  const byTTL = messages.filter((message) => {
    const messageAge = (Date.now() - message.created_at) / 1000;
    return messageAge > config.messagesToKeep.ttl;
  }).length;

  return Math.max(byMaxCount, byTTL);
}

function deleteMessageById(id) {
  return new Promise((resolve, reject) => {
    db.run(
      `DELETE
           FROM messages
           WHERE id = ?`,
      id,
      (error) => (error ? reject(error) : resolve())
    );
  });
}

function listAllMessages() {
  return new Promise((resolve, reject) => {
    db.all(
      `select *
             from messages
             order by created_at asc, id asc;`,
      [],
      (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows.map((row) => new Message(row)));
        }
      }
    );
  });
}

function listMessagesBySessionId(sessionId) {
  return new Promise((resolve, reject) => {
    db.all(
      `select *
             from messages
             where session_id = ?
             order by created_at asc, id asc;`,
      [sessionId],
      (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows.map((row) => new Message(row)));
        }
      }
    );
  });
}

function findMessageByClientId(sessionId, clientId) {
  return new Promise((resolve, reject) => {
    db.get(
      `select *
         from messages
        where session_id = ? and client_id = ?
        limit 1;`,
      [sessionId, clientId],
      (error, row) => {
        if (error) {
          reject(error);
        } else {
          resolve(row ? new Message(row) : null);
        }
      }
    );
  });
}

function clearMessagesBySessionId(sessionId) {
  return (async () => {
    await MessageService.autoPrune(sessionId, { pruneAllImmediately: true });
    return {};
  })();
}

class MessageService {
  static async addMessage(message, { sessionId, io }) {
    const messageId = await message.save();
    if (messageId === null && message.client_id) {
      const existing = await findMessageByClientId(
        sessionId,
        message.client_id
      );
      if (!existing) {
        throw new Error("Idempotent message could not be recovered");
      }
      existing.data = JSON.parse(existing.data);
      io.to(sessionId).emit(NEW_MESSAGE, existing);
      return existing;
    }

    message.id = messageId;
    try {
      await MessageService.autoPrune(sessionId);
    } catch (error) {
      console.error("failed to prune messages", error);
    }

    io.to(sessionId).emit(NEW_MESSAGE, message);
    return message;
  }

  static async autoPrune(
    sessionId,
    { pruneAllImmediately } = { pruneAllImmediately: false }
  ) {
    const messages = await listMessagesBySessionId(sessionId);

    const messagesToDelete = pruneAllImmediately
      ? messages.length
      : calcMessagesToDelete(messages);
    if (messagesToDelete <= 0) {
      return;
    }

    for (let message of messages.slice(0, messagesToDelete)) {
      const messageData = JSON.parse(message.data);
      if (messageData.type === "file") {
        try {
          await fs.promises.unlink(
            `./data/file-uploads/${messageData.access_key}`
          );
        } catch (ex) {
          if (ex.code !== "ENOENT") {
            console.error("failed to delete file", messageData.access_key, ex);
          }
        }
      }
      await deleteMessageById(message.id);
    }
  }
}

function startPeriodicAutoPrune() {
  let pruning = false;
  const runPrune = async () => {
    if (pruning) {
      return;
    }
    pruning = true;
    try {
      const allMessages = await listAllMessages();

      const sessionIds = [
        ...new Set(Array.from(allMessages).map((m) => m.session_id)),
      ];

      for (let sessionId of sessionIds) {
        await MessageService.autoPrune(sessionId);
      }
    } catch (error) {
      console.error("failed to periodically prune messages", error);
    } finally {
      pruning = false;
    }
  };

  const timer = setInterval(
    runPrune,
    config.messagesToKeep.pruneInterval * 1000
  );
  timer.unref();
  return timer;
}

export default MessageService;
export { listMessagesBySessionId, clearMessagesBySessionId };
export { listAllMessages };
export { findMessageByClientId };
export { deleteMessageById };
export { startPeriodicAutoPrune };
