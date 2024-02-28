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
  db.run(
    `DELETE
         FROM messages
         WHERE id = ?`,
    id
  );
}

function listAllMessages() {
  return new Promise((resolve, reject) => {
    db.all(
      `select *
             from messages;`,
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
             where session_id = ?;`,
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

function clearMessagesBySessionId(sessionId) {
  return (async () => {
    await MessageService.autoPrune(sessionId, { pruneAllImmediately: true });
    return {};
  })();
}

class MessageService {
  static async addMessage(message, { sessionId, io }) {
    message.id = await message.save();
    MessageService.autoPrune(sessionId);

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
          fs.unlinkSync(`./data/file-uploads/${messageData.access_key}`);
        } catch (ex) {
          console.error("failed to delete file", messageData.access_key, ex);
        }
      }
      deleteMessageById(message.id);
    }
  }
}

function startPeriodicAutoPrune() {
  setInterval(async () => {
    const allMessages = await listAllMessages();

    const sessionIds = [
      ...new Set(Array.from(allMessages).map((m) => m.session_id)),
    ];

    for (let sessionId of sessionIds) {
      MessageService.autoPrune(sessionId);
    }
  }, 1000);
}

export default MessageService;
export { listMessagesBySessionId, clearMessagesBySessionId };
export { listAllMessages };
export { deleteMessageById };
export { startPeriodicAutoPrune };
