import NProgress from "nprogress";

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
    const formData = new FormData();
    formData.append("file", file);
    formData.append("name", name);
    formData.append("sessionId", sessionId);
    NProgress.start();
    const resp = await fetch("file", {
      method: "POST",
      body: formData,
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
    const formData = new FormData();
    formData.append("text", text);
    formData.append("sessionId", sessionId);
    const resp = await fetch("text", {
      method: "POST",
      body: formData,
    });

    await resp.json();
  }
}

export { API_BASE, WEBSOCKET_BASE };
