import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { Server as SocketIOServer } from "socket.io";
import {
  NEW_MESSAGE,
  POST_MESSAGE,
} from "@transfer/api/consts/socketEvents.js";

import "./database.js";
import Message from "./models/message.js";
import multer from "multer";
import MessageService, {
  clearMessagesBySessionId,
  listMessagesBySessionId,
  startPeriodicAutoPrune,
} from "./services/MessageService.js";
import * as http from "http";
import config from "./config.js";

const app = express();

app.use(express.json());
app.use(cors());

app.get("/sessions/:id/history", async (req, res) => {
  res.send(await listMessagesBySessionId(req.params.id));
});

app.get("/sessions/:id/clear_messages", async (req, res) => {
  res.send(await clearMessagesBySessionId(req.params.id));
});

app.get("/serverside-config", async (req, res) => {
  res.send({ messagesToKeep: config.messagesToKeep });
});

app.post(
  "/upload",
  multer({ dest: "data/file-uploads/" }).single("file"),
  async (req, res) => {
    if (req.file) {
      res.json({ success: true, filename: req.file.filename });
    } else {
      res.json({ success: false, message: "No file was uploaded." });
    }
  }
);

app.get("/attachments/:access_key", (req, res) => {
  const fileName = req.query.fileName;
  const file = path.join("data/file-uploads", req.params.access_key);
  res.download(file, fileName);
});

const frontendRoot = fileURLToPath(
  path.join(path.dirname(import.meta.url), "frontend")
);
app.use(express.static(frontendRoot));
app.get("*", (req, res) => {
  res.sendFile(path.resolve(frontendRoot, "index.html"));
});

const httpServer = http.createServer(app);

const io = new SocketIOServer(httpServer, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"],
    credentials: true,
  },
});

io.on("connection", (socket) => {
  const sessionId = getSessionIdFromSocketHandshake(socket);
  socket.join(sessionId);

  socket.on(POST_MESSAGE, async (payload) => {
    const sessionId = getSessionIdFromSocketHandshake(socket);
    const message = new Message({
      session_id: sessionId,
      data: payload,
      created_at: +new Date(),
    });

    message.id = await message.save();

    MessageService.autoPrune(sessionId);

    io.to(sessionId).emit(NEW_MESSAGE, message);
  });
});

startPeriodicAutoPrune();

function getSessionIdFromSocketHandshake(socket) {
  return socket.handshake.headers["sessionid"];
}

httpServer.listen(6611, () => {
  console.log("server listening on port 6611");
});
