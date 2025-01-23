import NProgress from "nprogress";
import {encrypt} from "../utils/encryption.js";

const API_BASE =
  window.location.origin === "http://localhost:3000"
    ? "http://localhost:6611/"
    : window.origin + "/";
const WEBSOCKET_BASE =
  window.location.origin === "http://localhost:3000"
    ? "http://localhost:6611/"
    : window.origin + `/`;

function fetch(path, options) {
  return window.fetch(`${API_BASE}${path}`, options);
}

export default class ApiClient {
  static async loadSessionHistory(sessionId) {
    const resp = await fetch(`sessions/${sessionId}/history`);
    return (await resp.json()).map((x) => ({ ...x, data: JSON.parse(x.data) }));
  }

  static async getServerSideConfig() {
    const resp = await fetch(`serverside-config`);
    return await resp.json();
  }

  static async uploadAttachment(file, { name, sessionId }) {
    const fileBuffer = await file.arrayBuffer();
    const encrypted = await encrypt({
      filename: name,
      content: Array.from(new Uint8Array(fileBuffer)),
      sessionId,
      timestamp: Date.now()
    });

    NProgress.start();
    const resp = await fetch("u", {
      method: "POST",
      body: encrypted,
      signal: new AbortController().signal,
      onUploadProgress: (event) => {
        if (event.lengthComputable) {
          const progress = event.loaded / event.total;
          NProgress.set(progress);
        }
      },
    });

    NProgress.done();
    return await resp.json();
  }

  static async deleteEverythingInSession(id) {
    const resp = await fetch(`sessions/${id}/clear_messages`);
    return await resp.json();
  }

  static async sendText(text, { sessionId }) {
    const encrypted = await encrypt({
      text,
      sessionId,
      timestamp: Date.now()
    });

    const resp = await fetch("t", {
      method: "POST",
      headers: {
        'Content-Type': 'application/octet-stream'
      },
      body: encrypted
    });
    return await resp.json();
  }
}

export { API_BASE, WEBSOCKET_BASE };
