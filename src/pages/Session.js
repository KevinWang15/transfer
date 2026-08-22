import React from "react";
import withRouter from "../utils/withRouter.js";
import { io } from "socket.io-client";
import ApiClient, { API_BASE, WEBSOCKET_BASE } from "../apiclient/apiClient.js";
import {
  NEW_MESSAGE,
  POST_MESSAGE,
} from "@transfer/api/consts/socketEvents.js";
import toast from "../utils/toast.js";
import "./Session.scss";
import Message from "../components/Message.js";
import { IonIcon } from "@ionic/react";
import {
  attachOutline,
  cloudUploadOutline,
  copyOutline,
  imagesOutline,
  linkOutline,
  qrCodeOutline,
  sendOutline,
  swapHorizontalOutline,
  terminalOutline,
  trashOutline,
} from "ionicons/icons/index.js";
import QRCode from "qrcode";
import sweetalert2 from "sweetalert2";
import copy from "copy-to-clipboard";
import { createRoot } from "react-dom/client";
import { stripTrailingSlash } from "../utils/utils.js";
import UploadProgress from "../components/UploadProgress.js";

class Session extends React.Component {
  state = {
    messages: [],
    textboxText: "",
    serversideConfig: null,
    uploadProgress: null,
    connectionStatus: "connecting",
    historyLoaded: false,
    isDraggingFiles: false,
  };

  socket = null;
  uploadQueue = Promise.resolve();
  mainRef = React.createRef();
  dragDepth = 0;

  constructor(props) {
    super(props);
    this.socket = io(`${WEBSOCKET_BASE}`, {
      extraHeaders: {
        sessionId: props.router.params.id,
      },
    });

    this.socket.on("connect", () => {
      this.setState({ connectionStatus: "connected" });
    });

    this.socket.on("disconnect", () => {
      this.setState({ connectionStatus: "offline" });
      toast("Connection lost — trying to reconnect.", { duration: 3000 });
    });

    this.socket.on(NEW_MESSAGE, (...args) => {
      this.setState(
        (state) => ({
          messages: [...state.messages, args[0]],
        }),
        this.scrollToBottom
      );
    });
  }

  componentDidMount() {
    this.loadSessionHistory();
    ApiClient.getServerSideConfig()
      .then((serversideConfig) => {
        this.setState({ serversideConfig });
      })
      .catch((error) => {
        console.error("server configuration failed to load", error);
      });
    this.addDragDropListener();
  }

  componentWillUnmount() {
    this.removeDragDropListener();
    this.socket?.disconnect();
  }

  socketOps = {
    postMessage: (message) => {
      this.socket.emit(POST_MESSAGE, message);
    },
  };

  removeDragDropListener = () => {};

  sendFile = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.onchange = async () => {
      await this.uploadFiles(input.files);
    };

    document.body.appendChild(input);
    input.click();
    document.body.removeChild(input);
  };

  copySessionLink = () => {
    copy(window.location.href);
    toast("Session link copied.", { duration: 2000 });
  };

  async deleteEverythingInThisSession() {
    const result = await sweetalert2.fire({
      title: "Clear this session?",
      text: "Every message and uploaded file in this session will be permanently removed.",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Clear session",
      cancelButtonText: "Keep everything",
      reverseButtons: true,
    });

    if (!result.isConfirmed) {
      return;
    }

    try {
      await ApiClient.deleteEverythingInSession(this.props.router.params.id);
      toast("Session cleared.", { duration: 2000 });
      this.setState({ messages: [] });
    } catch (error) {
      console.error("session could not be cleared", error);
      toast("Could not clear the session. Please try again.", {
        duration: 3000,
      });
    }
  }

  uploadFiles = (files) => {
    const pendingFiles = Array.from(files || []);
    const queuedUpload = this.uploadQueue.then(() =>
      this.performUploads(pendingFiles)
    );
    this.uploadQueue = queuedUpload.catch(() => {});
    return queuedUpload;
  };

  async performUploads(files) {
    for (const [index, inputFile] of files.entries()) {
      const fileDetails = {
        filename: inputFile.name,
        fileIndex: index + 1,
        totalFiles: files.length,
      };
      this.setState({
        uploadProgress: {
          ...fileDetails,
          phase: "preparing",
          uploadedBytes: 0,
          totalBytes: inputFile.size,
          progress: 0,
          speedBytesPerSecond: 0,
          etaSeconds: null,
        },
      });

      try {
        await ApiClient.uploadAttachment(inputFile, {
          name: inputFile.name,
          sessionId: this.props.router.params.id,
          onProgress: (uploadProgress) =>
            this.setState({
              uploadProgress: { ...fileDetails, ...uploadProgress },
            }),
        });
      } catch (error) {
        console.error("file upload failed", error);
        toast(`Upload failed: ${inputFile.name} (${error.message})`, {
          duration: 4000,
        });
      }
    }

    this.setState({ uploadProgress: null });
  }

  handlePaste = async (event) => {
    const imageItem = Array.from(event.clipboardData?.items || []).find(
      (item) => item.kind === "file" && item.type.startsWith("image/")
    );

    if (!imageItem) {
      return;
    }

    const image = imageItem.getAsFile();
    if (!image) {
      return;
    }

    event.preventDefault();

    const previewUrl = URL.createObjectURL(image);
    try {
      const result = await sweetalert2.fire({
        title: "Send this image?",
        imageUrl: previewUrl,
        imageAlt: "Clipboard image preview",
        showCancelButton: true,
        confirmButtonText: "Send image",
        cancelButtonText: "Cancel",
      });

      if (result.isConfirmed) {
        await this.uploadFiles([image]);
      }
    } finally {
      URL.revokeObjectURL(previewUrl);
    }
  };

  sendTextMessage = async () => {
    if (!this.state.textboxText.trim()) {
      return;
    }

    try {
      await ApiClient.sendText(this.state.textboxText, {
        sessionId: this.props.router.params.id,
      });
      this.setState({ textboxText: "" });
    } catch (error) {
      console.error("message send failed", error);
      toast("Message could not be sent. Please try again.", {
        duration: 3000,
      });
    }
  };

  scrollToBottom = () => {
    const main = this.mainRef.current;
    if (!main) {
      return;
    }

    main.scrollTo({
      top: main.scrollHeight,
      behavior: "smooth",
    });
  };

  render() {
    const sessionId = this.props.router.params.id;
    const { connectionStatus, historyLoaded, messages, serversideConfig } =
      this.state;
    const retentionDays = serversideConfig
      ? serversideConfig.messagesToKeep.ttl / 86400
      : null;

    return (
      <div className="session-shell">
        <header className="session-header">
          <div className="session-header-inner">
            <button
              type="button"
              className="session-brand"
              onClick={() => this.props.router.navigate("/")}
              aria-label="Back to Transfer home"
            >
              <span className="session-brand-mark" aria-hidden="true">
                <IonIcon icon={swapHorizontalOutline} />
              </span>
              <span>Transfer</span>
            </button>

            <div className="session-identity">
              <div className="session-identity-label">
                <span>SESSION</span>
                <span className={`connection-state ${connectionStatus}`}>
                  <span />
                  {connectionStatus === "connected"
                    ? "Connected"
                    : connectionStatus === "offline"
                    ? "Reconnecting"
                    : "Connecting"}
                </span>
              </div>
              <div className="session-id-row">
                <h1 title={sessionId}>{sessionId}</h1>
                <button
                  type="button"
                  className="session-copy-link"
                  onClick={this.copySessionLink}
                  aria-label="Copy session link"
                  title="Copy session link"
                >
                  <IonIcon icon={copyOutline} />
                </button>
              </div>
            </div>

            <nav className="session-actions" aria-label="Session actions">
              <button
                type="button"
                onClick={() => this.displayCurlCmd()}
                aria-label="Command line access"
                title="Command line access"
              >
                <IonIcon icon={terminalOutline} />
                <span>CLI</span>
              </button>
              <button
                type="button"
                onClick={() => this.displayQRCode()}
                aria-label="Show session QR code"
                title="Show session QR code"
              >
                <IonIcon icon={qrCodeOutline} />
                <span>QR code</span>
              </button>
              <button
                type="button"
                className="share-link-action"
                onClick={this.copySessionLink}
                aria-label="Copy session link"
                title="Copy session link"
              >
                <IonIcon icon={linkOutline} />
                <span>Copy link</span>
              </button>
            </nav>
          </div>
        </header>

        <UploadProgress upload={this.state.uploadProgress} />

        <main className="session-main" ref={this.mainRef}>
          <div className="session-content">
            {!historyLoaded ? (
              <div className="session-loading" aria-label="Loading messages">
                <span />
                <span />
                <span />
              </div>
            ) : messages.length ? (
              <div className="session-message-list">
                <div className="message-day-divider">
                  <span>Session activity</span>
                </div>
                {messages.map((message) => (
                  <Message message={message} key={message.id} />
                ))}
              </div>
            ) : (
              <div className="session-empty-state">
                <div className="empty-state-icon">
                  <IonIcon icon={cloudUploadOutline} />
                </div>
                <span className="empty-state-eyebrow">
                  YOUR SESSION IS READY
                </span>
                <h2>Send something worth sharing.</h2>
                <p>
                  Drop files anywhere, paste an image, or write a note below.
                  Everything shared here appears instantly for anyone with the
                  link.
                </p>
                <div className="empty-state-actions">
                  <button type="button" onClick={this.sendFile}>
                    <IonIcon icon={attachOutline} />
                    Choose files
                  </button>
                  <button type="button" onClick={this.copySessionLink}>
                    <IonIcon icon={linkOutline} />
                    Invite someone
                  </button>
                </div>
              </div>
            )}
          </div>
        </main>

        <footer className="session-footer">
          <div className="session-footer-inner">
            <div className="session-composer">
              <button
                type="button"
                className="send-file-btn composer-attach"
                onClick={this.sendFile}
                aria-label="Upload files"
                title="Upload files"
              >
                <IonIcon icon={attachOutline} />
              </button>
              <textarea
                rows="2"
                value={this.state.textboxText}
                placeholder="Write a message or paste an image…"
                aria-label="Message"
                onPaste={this.handlePaste}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    (event.metaKey || event.ctrlKey)
                  ) {
                    event.preventDefault();
                    this.sendTextMessage();
                  }
                }}
                onChange={(event) =>
                  this.setState({ textboxText: event.target.value })
                }
              />
              <button
                type="button"
                className="send-text-btn composer-send"
                onClick={this.sendTextMessage}
                disabled={!this.state.textboxText.trim()}
                aria-label="Send message"
                title="Send message"
              >
                <IonIcon icon={sendOutline} />
              </button>
            </div>

            <div className="composer-details">
              <div className="composer-hints">
                <span>
                  <IonIcon icon={imagesOutline} />
                  Paste images
                </span>
                <span className="keyboard-hint">
                  <kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>Enter</kbd> to send
                </span>
              </div>

              {serversideConfig && (
                <div className="retention-summary">
                  <span>
                    Latest {serversideConfig.messagesToKeep.maxCount} items ·{" "}
                    {retentionDays}-day retention
                  </span>
                  <button
                    type="button"
                    onClick={() => this.deleteEverythingInThisSession()}
                  >
                    <IonIcon icon={trashOutline} />
                    Clear session
                  </button>
                </div>
              )}
            </div>
          </div>
        </footer>

        {this.state.isDraggingFiles && (
          <div className="drop-overlay" aria-hidden="true">
            <div>
              <IonIcon icon={cloudUploadOutline} />
              <strong>Drop to upload</strong>
              <span>Your files will be encrypted and sent to this session</span>
            </div>
          </div>
        )}
      </div>
    );
  }

  loadSessionHistory() {
    ApiClient.loadSessionHistory(this.props.router.params.id)
      .then((messages) => {
        this.setState(
          {
            messages,
            historyLoaded: true,
          },
          this.scrollToBottom
        );
      })
      .catch((error) => {
        console.error("session history failed to load", error);
        this.setState({ historyLoaded: true });
        toast("Could not load earlier session activity.", { duration: 3000 });
      });
  }

  addDragDropListener = () => {
    const hasFiles = (event) =>
      Array.from(event.dataTransfer?.types || []).includes("Files");

    const dragenterListener = (event) => {
      if (!hasFiles(event)) {
        return;
      }
      event.preventDefault();
      this.dragDepth += 1;
      this.setState({ isDraggingFiles: true });
    };

    const dragoverListener = (event) => {
      if (hasFiles(event)) {
        event.preventDefault();
      }
    };

    const dragleaveListener = (event) => {
      if (this.dragDepth === 0) {
        return;
      }
      event.preventDefault();
      this.dragDepth = Math.max(0, this.dragDepth - 1);
      if (this.dragDepth === 0) {
        this.setState({ isDraggingFiles: false });
      }
    };

    const dropListener = (event) => {
      if (!hasFiles(event) && this.dragDepth === 0) {
        return;
      }
      event.preventDefault();
      this.dragDepth = 0;
      this.setState({ isDraggingFiles: false });
      if (event.dataTransfer.files.length) {
        this.uploadFiles(event.dataTransfer.files);
      }
    };

    document.addEventListener("dragenter", dragenterListener);
    document.addEventListener("dragover", dragoverListener);
    document.addEventListener("dragleave", dragleaveListener);
    document.addEventListener("drop", dropListener);

    this.removeDragDropListener = () => {
      document.removeEventListener("dragenter", dragenterListener);
      document.removeEventListener("dragover", dragoverListener);
      document.removeEventListener("dragleave", dragleaveListener);
      document.removeEventListener("drop", dropListener);
    };
  };

  async generateQRCode(url) {
    try {
      const canvas = await QRCode.toCanvas(url, {
        width: 720,
      });
      return canvas.toDataURL();
    } catch (error) {
      console.error("Error generating QR code:", error);
      return null;
    }
  }

  async displayCurlCmd() {
    const swalContent = document.createElement("div");
    const sendTextCurl = `curl -X POST -F "text=your-text-here" -F "sessionId=${
      this.props.router.params.id
    }" ${stripTrailingSlash(API_BASE)}/text`;
    const sendFileCurl = `curl -X POST -F "file=@path-to-your-file" -F "sessionId=${
      this.props.router.params.id
    }" ${stripTrailingSlash(API_BASE)}/file`;

    let reactRoot;
    sweetalert2.fire({
      title: "Command line access",
      html: swalContent,
      showConfirmButton: false,
      showCloseButton: true,
      didOpen: () => {
        reactRoot = createRoot(swalContent);
        reactRoot.render(
          <div className="curl-commands">
            <p>
              Use the direct HTTP endpoints from scripts, terminals, and
              automations. Click a command to copy it.
            </p>
            <button
              type="button"
              className="curl-command"
              onClick={() => {
                copy(sendTextCurl);
                toast("Text command copied.");
              }}
            >
              <span>
                Send text <IonIcon icon={copyOutline} />
              </span>
              <code>{sendTextCurl}</code>
            </button>
            <button
              type="button"
              className="curl-command"
              onClick={() => {
                copy(sendFileCurl);
                toast("File command copied.");
              }}
            >
              <span>
                Direct file upload · unencrypted
                <IonIcon icon={copyOutline} />
              </span>
              <code>{sendFileCurl}</code>
            </button>
          </div>
        );
      },
      willClose: () => {
        reactRoot?.unmount();
      },
    });
  }

  async displayQRCode() {
    const qrCodeDataURL = await this.generateQRCode(window.location.href);

    if (qrCodeDataURL) {
      sweetalert2.fire({
        imageUrl: qrCodeDataURL,
        imageWidth: 360,
        title: "Open this session",
        text: "Scan with another device to join instantly.",
        showCloseButton: true,
        showConfirmButton: false,
      });
    } else {
      sweetalert2.fire({
        icon: "error",
        title: "QR code unavailable",
        text: "The QR code could not be generated. Copy the session link instead.",
      });
    }
  }
}

export default withRouter(Session);
