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
  "/file",
  multer({ dest: "data/file-uploads/" }).single("file"),
  async (req, res) => {
    if (req.file) {
      const newMessage = new Message({
        session_id: req.body.sessionId,
        data: {
          type: "file",
          filename: req.body.name || req.file.originalname,
          access_key: req.file.filename,
        },
        created_at: +new Date(),
      });

      await MessageService.addMessage(newMessage, {
        sessionId: req.body.sessionId,
        io,
      });

      res.json({ success: true });
    } else {
      res.json({ success: false, message: "No file was uploaded." });
    }
  }
);

app.post("/text", multer({}).any(), async (req, res) => {
  const newMessage = new Message({
    session_id: req.body.sessionId,
    data: {
      type: "text",
      text: req.body.text,
    },
    created_at: +new Date(),
  });

  await MessageService.addMessage(newMessage, {
    sessionId: req.body.sessionId,
    io,
  });

  res.json({ success: true });
});

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
});

startPeriodicAutoPrune();

function getSessionIdFromSocketHandshake(socket) {
  return socket.handshake.headers["sessionid"];
}

httpServer.listen(6611, () => {
  console.log("server listening on port 6611");
});
