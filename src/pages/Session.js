import React from "react";
import withRouter from "../utils/withRouter.js";
import { io } from "socket.io-client";
import ApiClient, { API_BASE, WEBSOCKET_BASE } from "../apiclient/apiClient.js";
import { NEW_MESSAGE } from "@transfer/api/consts/socketEvents.js";
import toast from "../utils/toast.js";
import "./Session.scss";
import Message from "../components/Message.js";
import { IonIcon } from "@ionic/react";
import {
  attachOutline,
  arrowDownOutline,
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
import { stripTrailingSlash } from "../utils/utils.js";
import { showDialog } from "../utils/feedback.js";
import { copyText } from "../utils/clipboard.js";
import UploadProgress from "../components/UploadProgress.js";
import {
  createQueuedUploads,
  summarizeUploadQueue,
  UPLOAD_PHASES,
} from "../utils/uploadQueue.js";
import {
  createPendingTextMessage,
  DELIVERY_STATUS,
  messagesMatch,
  reconcileIncomingMessage,
  reconcileMessageHistory,
  removeLocalMessage,
  updateLocalDeliveryStatus,
} from "../utils/messageState.js";

class Session extends React.Component {
  state = {
    messages: [],
    textboxText: "",
    serversideConfig: null,
    uploads: [],
    connectionStatus: "connecting",
    historyLoaded: false,
    isDraggingFiles: false,
    hasUnseenMessages: false,
  };

  socket = null;
  uploadQueue = Promise.resolve();
  mainRef = React.createRef();
  textareaRef = React.createRef();
  dragDepth = 0;
  hasConnected = false;
  hasMounted = false;
  confirmationTimers = new Set();
  uploadCleanupTimer = null;
  uploadGeneration = 0;
  announcedUploadGeneration = 0;

  constructor(props) {
    super(props);
    this.state = {
      ...this.state,
      textboxText: this.loadDraft(props.router.params.id),
    };
    this.socket = io(`${WEBSOCKET_BASE}`, {
      extraHeaders: {
        sessionId: props.router.params.id,
      },
    });

    this.socket.on("connect", () => {
      const isReconnect = this.hasConnected;
      this.hasConnected = true;
      if (!this.hasMounted) {
        return;
      }
      this.setState({ connectionStatus: "connected" });
      if (isReconnect) {
        this.loadSessionHistory({ silent: true });
      }
    });

    this.socket.on("disconnect", () => {
      if (!this.hasMounted) {
        return;
      }
      this.setState({ connectionStatus: "offline" });
      toast("Connection lost — trying to reconnect.", {
        duration: 4000,
        tone: "warning",
      });
    });

    this.socket.on(NEW_MESSAGE, this.receiveMessage);
  }

  componentDidMount() {
    this.hasMounted = true;
    if (this.socket.connected) {
      this.setState({ connectionStatus: "connected" });
    }
    this.loadSessionHistory();
    ApiClient.getServerSideConfig()
      .then((serversideConfig) => {
        this.setState({ serversideConfig });
      })
      .catch((error) => {
        console.error("server configuration failed to load", error);
      });
    this.addDragDropListener();
    this.resizeComposer();
  }

  componentWillUnmount() {
    this.hasMounted = false;
    this.removeDragDropListener();
    this.confirmationTimers.forEach((timer) => window.clearTimeout(timer));
    this.confirmationTimers.clear();
    window.clearTimeout(this.uploadCleanupTimer);
    this.socket?.removeAllListeners();
    this.socket?.disconnect();
  }

  removeDragDropListener = () => {};

  draftStorageKey = (sessionId = this.props.router.params.id) =>
    `transfer.session-draft.${sessionId}`;

  loadDraft = (sessionId) => {
    try {
      return window.localStorage.getItem(this.draftStorageKey(sessionId)) || "";
    } catch (error) {
      return "";
    }
  };

  persistDraft = (text) => {
    try {
      const key = this.draftStorageKey();
      if (text) {
        window.localStorage.setItem(key, text);
      } else {
        window.localStorage.removeItem(key);
      }
    } catch (error) {
      // Draft persistence is a convenience and should never block composing.
    }
  };

  handleTextChange = (event) => {
    const textboxText = event.target.value;
    this.persistDraft(textboxText);
    this.setState({ textboxText }, this.resizeComposer);
  };

  resizeComposer = () => {
    const textarea = this.textareaRef.current;
    if (!textarea) {
      return;
    }
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 130)}px`;
  };

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

  copySessionLink = async () => {
    try {
      await copyText(window.location.href);
      toast("Session link copied.", { duration: 2400, tone: "success" });
    } catch (error) {
      toast("Could not copy the session link.", {
        duration: 3600,
        tone: "error",
      });
    }
  };

  async deleteEverythingInThisSession() {
    const result = await showDialog({
      icon: trashOutline,
      tone: "danger",
      eyebrow: "Permanent action",
      title: "Clear this session?",
      description:
        "Every message and uploaded file in this session will be permanently removed. This cannot be undone.",
      showCancel: true,
      confirmLabel: "Clear session",
      cancelLabel: "Keep everything",
    });

    if (!result.isConfirmed) {
      return;
    }

    try {
      await ApiClient.deleteEverythingInSession(this.props.router.params.id);
      toast("Session cleared.", { duration: 2600, tone: "success" });
      this.setState({ messages: [] });
    } catch (error) {
      console.error("session could not be cleared", error);
      toast("Could not clear the session. Please try again.", {
        duration: 4000,
        tone: "error",
      });
    }
  }

  uploadFiles = (files) => {
    const pendingUploads = createQueuedUploads(files);
    if (!pendingUploads.length) {
      return Promise.resolve();
    }

    window.clearTimeout(this.uploadCleanupTimer);
    this.uploadGeneration += 1;
    const queuedUpload = new Promise((resolve, reject) => {
      this.setState(
        (state) => ({ uploads: [...state.uploads, ...pendingUploads] }),
        () => this.queueUploadBatch(pendingUploads).then(resolve, reject)
      );
    });

    if (pendingUploads.length > 1) {
      toast(
        `${pendingUploads.length} files added — they’ll upload one at a time.`,
        { duration: 3200, tone: "info" }
      );
    }

    return queuedUpload;
  };

  queueUploadBatch = (uploads) => {
    const queuedUpload = this.uploadQueue.then(() =>
      this.performUploads(uploads)
    );
    this.uploadQueue = queuedUpload.catch(() => {});
    return queuedUpload;
  };

  updateUpload = (id, changes, callback) => {
    if (!this.hasMounted) {
      callback?.();
      return;
    }
    this.setState(
      (state) => ({
        uploads: state.uploads.map((upload) =>
          upload.id === id ? { ...upload, ...changes } : upload
        ),
      }),
      callback
    );
  };

  async performUploads(uploads) {
    for (const upload of uploads) {
      const queuedUpload = this.state.uploads.find(
        (candidate) => candidate.id === upload.id
      );
      if (!queuedUpload || queuedUpload.phase !== UPLOAD_PHASES.queued) {
        continue;
      }

      this.updateUpload(upload.id, {
        phase: UPLOAD_PHASES.preparing,
        uploadedBytes: 0,
        confirmedBytes: 0,
        progress: 0,
        speedBytesPerSecond: 0,
        etaSeconds: null,
        error: null,
      });

      try {
        await ApiClient.uploadAttachment(upload.file, {
          name: upload.filename,
          sessionId: this.props.router.params.id,
          onProgress: (progress) => this.updateUpload(upload.id, progress),
        });
        await new Promise((resolve) =>
          this.updateUpload(
            upload.id,
            {
              phase: UPLOAD_PHASES.complete,
              uploadedBytes: upload.totalBytes,
              confirmedBytes: upload.totalBytes,
              progress: 1,
              speedBytesPerSecond: 0,
              etaSeconds: 0,
            },
            resolve
          )
        );
      } catch (error) {
        console.error("file upload failed", error);
        await new Promise((resolve) =>
          this.updateUpload(
            upload.id,
            {
              phase: UPLOAD_PHASES.failed,
              speedBytesPerSecond: 0,
              etaSeconds: null,
              error: error.message || "Upload failed",
            },
            resolve
          )
        );
        toast(`Upload failed: ${upload.filename} (${error.message})`, {
          duration: 5000,
          tone: "error",
        });
      }
    }

    this.finishUploadQueue();
  }

  finishUploadQueue = () => {
    if (!this.hasMounted) {
      return;
    }
    const summary = summarizeUploadQueue(this.state.uploads);
    if (summary.queuedCount || summary.activeCount) {
      return;
    }
    if (this.announcedUploadGeneration === this.uploadGeneration) {
      return;
    }

    this.announcedUploadGeneration = this.uploadGeneration;
    if (summary.failedCount) {
      toast(
        `${summary.completedCount} uploaded · ${summary.failedCount} failed.`,
        { duration: 5000, tone: "warning" }
      );
      return;
    }

    toast(
      `${summary.completedCount} ${
        summary.completedCount === 1 ? "file" : "files"
      } uploaded.`,
      { duration: 3000, tone: "success" }
    );
    const completedGeneration = this.uploadGeneration;
    this.uploadCleanupTimer = window.setTimeout(() => {
      if (completedGeneration !== this.uploadGeneration) {
        return;
      }
      this.setState((state) => {
        const current = summarizeUploadQueue(state.uploads);
        return current.queuedCount || current.activeCount
          ? null
          : { uploads: [] };
      });
    }, 4000);
  };

  retryUpload = (id) => {
    const upload = this.state.uploads.find(
      (candidate) =>
        candidate.id === id && candidate.phase === UPLOAD_PHASES.failed
    );
    if (!upload) {
      return;
    }

    window.clearTimeout(this.uploadCleanupTimer);
    this.uploadGeneration += 1;
    this.updateUpload(
      id,
      {
        phase: UPLOAD_PHASES.queued,
        uploadedBytes: 0,
        confirmedBytes: 0,
        progress: 0,
        speedBytesPerSecond: 0,
        etaSeconds: null,
        error: null,
      },
      () => this.queueUploadBatch([upload])
    );
  };

  removeQueuedUpload = (id) => {
    this.setState((state) => ({
      uploads: state.uploads.filter(
        (upload) => upload.id !== id || upload.phase !== UPLOAD_PHASES.queued
      ),
    }));
  };

  dismissUploadQueue = () => {
    const summary = summarizeUploadQueue(this.state.uploads);
    if (!summary.activeCount && !summary.queuedCount) {
      window.clearTimeout(this.uploadCleanupTimer);
      this.setState({ uploads: [] });
    }
  };

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
      const result = await showDialog({
        icon: imagesOutline,
        eyebrow: "Clipboard image",
        title: "Send this image?",
        description: "Review the image before adding it to this session.",
        image: {
          src: previewUrl,
          alt: "Clipboard image preview",
        },
        showCancel: true,
        confirmLabel: "Send image",
        cancelLabel: "Cancel",
      });

      if (result.isConfirmed) {
        await this.uploadFiles([image]);
      }
    } finally {
      URL.revokeObjectURL(previewUrl);
    }
  };

  sendTextMessage = () => {
    const text = this.state.textboxText;
    if (!text.trim()) {
      return;
    }

    const pendingMessage = createPendingTextMessage({
      text,
      sessionId: this.props.router.params.id,
    });
    this.persistDraft("");
    this.setState(
      (state) => ({
        messages: [...state.messages, pendingMessage],
        textboxText: "",
        hasUnseenMessages: false,
      }),
      () => {
        this.resizeComposer();
        this.scrollToBottom();
      }
    );
    this.deliverTextMessage(pendingMessage);
  };

  deliverTextMessage = async (message) => {
    try {
      await ApiClient.sendText(message.data.text, {
        sessionId: this.props.router.params.id,
        clientId: message.client_id,
        timestamp: message.created_at,
      });
      if (!this.hasMounted) {
        return;
      }
      this.setState((state) => ({
        messages: updateLocalDeliveryStatus(
          state.messages,
          message.client_id,
          DELIVERY_STATUS.sent
        ),
      }));
      this.scheduleConfirmationRefresh(message.client_id);
    } catch (error) {
      if (!this.hasMounted) {
        return;
      }
      this.setState((state) => ({
        messages: updateLocalDeliveryStatus(
          state.messages,
          message.client_id,
          DELIVERY_STATUS.failed
        ),
      }));
    }
  };

  retryTextMessage = (message) => {
    this.setState(
      (state) => ({
        messages: updateLocalDeliveryStatus(
          state.messages,
          message.client_id,
          DELIVERY_STATUS.sending
        ),
      }),
      () => this.deliverTextMessage(message)
    );
  };

  editFailedMessage = (message) => {
    this.setState(
      (state) => {
        const textboxText = state.textboxText
          ? `${message.data.text}\n${state.textboxText}`
          : message.data.text;
        this.persistDraft(textboxText);
        return {
          messages: removeLocalMessage(state.messages, message.client_id),
          textboxText,
        };
      },
      () => {
        this.resizeComposer();
        this.textareaRef.current?.focus();
      }
    );
  };

  scheduleConfirmationRefresh = (clientId) => {
    const timer = window.setTimeout(() => {
      this.confirmationTimers.delete(timer);
      const needsConfirmation = this.state.messages.some(
        (message) =>
          message.client_id === clientId &&
          message.deliveryStatus === DELIVERY_STATUS.sent
      );
      if (this.hasMounted && needsConfirmation) {
        this.loadSessionHistory({ silent: true });
      }
    }, 1200);
    this.confirmationTimers.add(timer);
  };

  receiveMessage = (incomingMessage) => {
    const shouldFollow = this.isNearBottom();
    this.setState(
      (state) => {
        const isKnown = state.messages.some((message) =>
          messagesMatch(message, incomingMessage)
        );
        return {
          messages: reconcileIncomingMessage(state.messages, incomingMessage),
          hasUnseenMessages:
            state.hasUnseenMessages || (!shouldFollow && !isKnown),
        };
      },
      () => {
        if (shouldFollow) {
          this.scrollToBottom();
        }
      }
    );
  };

  isNearBottom = () => {
    const main = this.mainRef.current;
    if (!main) {
      return true;
    }
    return main.scrollHeight - main.scrollTop - main.clientHeight < 120;
  };

  handleMainScroll = () => {
    if (this.state.hasUnseenMessages && this.isNearBottom()) {
      this.setState({ hasUnseenMessages: false });
    }
  };

  scrollToBottom = (behavior = "smooth") => {
    const main = this.mainRef.current;
    if (!main) {
      return;
    }

    window.requestAnimationFrame(() => {
      main.scrollTo({
        top: main.scrollHeight,
        behavior,
      });
      if (this.state.hasUnseenMessages) {
        this.setState({ hasUnseenMessages: false });
      }
    });
  };

  render() {
    const sessionId = this.props.router.params.id;
    const {
      connectionStatus,
      hasUnseenMessages,
      historyLoaded,
      messages,
      serversideConfig,
      uploads,
    } = this.state;
    const retentionDays = serversideConfig
      ? serversideConfig.messagesToKeep.ttl / 86400
      : null;
    const sendingCount = messages.filter(
      (message) => message.deliveryStatus === DELIVERY_STATUS.sending
    ).length;
    const failedCount = messages.filter(
      (message) => message.deliveryStatus === DELIVERY_STATUS.failed
    ).length;
    const uploadSummary = summarizeUploadQueue(uploads);
    const uploadsBusy = Boolean(
      uploadSummary.queuedCount || uploadSummary.activeCount
    );

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

        <UploadProgress
          uploads={uploads}
          onDismiss={this.dismissUploadQueue}
          onRemove={this.removeQueuedUpload}
          onRetry={this.retryUpload}
        />

        <main
          className="session-main"
          ref={this.mainRef}
          onScroll={this.handleMainScroll}
        >
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
                  <Message
                    message={message}
                    key={message.client_id || message.id}
                    onRetry={this.retryTextMessage}
                    onEdit={this.editFailedMessage}
                  />
                ))}
              </div>
            ) : (
              <div className="session-empty-state">
                <div className="empty-state-icon">
                  <IonIcon icon={cloudUploadOutline} />
                </div>
                <span className="empty-state-eyebrow">EMPTY SESSION</span>
                <h2>No files or messages</h2>
                <p>
                  Upload a file, paste an image, or enter a message. Items are
                  available to anyone with the session link.
                </p>
                <div className="empty-state-actions">
                  <button type="button" onClick={this.sendFile}>
                    <IonIcon icon={attachOutline} />
                    Choose files
                  </button>
                  <button type="button" onClick={this.copySessionLink}>
                    <IonIcon icon={linkOutline} />
                    Copy session link
                  </button>
                </div>
              </div>
            )}
          </div>
        </main>

        <footer className="session-footer">
          {hasUnseenMessages && (
            <button
              type="button"
              className="jump-to-latest"
              onClick={() => this.scrollToBottom()}
            >
              <IonIcon icon={arrowDownOutline} />
              New activity
            </button>
          )}
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
                ref={this.textareaRef}
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
                onChange={this.handleTextChange}
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
                {(sendingCount > 0 || failedCount > 0) && (
                  <span
                    className={`composer-delivery-summary ${
                      failedCount ? "failed" : "sending"
                    }`}
                    role="status"
                  >
                    <span aria-hidden="true" />
                    {failedCount
                      ? `${failedCount} ${
                          failedCount === 1 ? "message needs" : "messages need"
                        } attention`
                      : `Sending ${sendingCount} ${
                          sendingCount === 1 ? "message" : "messages"
                        }`}
                  </span>
                )}
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
                    disabled={sendingCount > 0 || uploadsBusy}
                    title={
                      sendingCount
                        ? "Wait for messages to finish sending"
                        : uploadsBusy
                        ? "Wait for uploads to finish"
                        : "Clear this session"
                    }
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

  loadSessionHistory({ silent = false } = {}) {
    const shouldFollow = !this.state.historyLoaded || this.isNearBottom();
    const messagesAtRequest = this.state.messages;
    ApiClient.loadSessionHistory(this.props.router.params.id)
      .then((history) => {
        this.setState(
          (state) => {
            const hasNewMessages = history.some(
              (historyMessage) =>
                !state.messages.some((message) =>
                  messagesMatch(message, historyMessage)
                )
            );
            return {
              messages: reconcileMessageHistory(
                state.messages,
                history,
                messagesAtRequest
              ),
              historyLoaded: true,
              hasUnseenMessages:
                state.hasUnseenMessages || (!shouldFollow && hasNewMessages),
            };
          },
          () => {
            if (shouldFollow) {
              this.scrollToBottom(silent ? "smooth" : "auto");
            }
          }
        );
      })
      .catch((error) => {
        console.error("session history failed to load", error);
        this.setState({ historyLoaded: true });
        if (!silent) {
          toast("Could not load earlier session activity.", {
            duration: 4000,
            tone: "error",
          });
        }
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
    const sendTextCurl = `curl -X POST -F "text=your-text-here" -F "sessionId=${
      this.props.router.params.id
    }" ${stripTrailingSlash(API_BASE)}/text`;
    const sendFileCurl = `curl -X POST -F "file=@path-to-your-file" -F "sessionId=${
      this.props.router.params.id
    }" ${stripTrailingSlash(API_BASE)}/file`;
    const historyCurl = `curl ${stripTrailingSlash(API_BASE)}/sessions/${
      this.props.router.params.id
    }/history`;
    const cleanupCurl = `curl -X DELETE ${stripTrailingSlash(
      API_BASE
    )}/sessions/${this.props.router.params.id}/history`;

    const curlCommands = [
      { label: "Send text", command: sendTextCurl },
      {
        label: "Direct file upload · returns download URL",
        command: sendFileCurl,
      },
      { label: "Get session history", command: historyCurl },
      { label: "Delete session history and files", command: cleanupCurl },
    ];

    await showDialog({
      icon: terminalOutline,
      eyebrow: "Developer tools",
      title: "Command line access",
      description:
        "Use the direct HTTP endpoints from scripts, terminals, and automations. Click a command to copy it.",
      size: "wide",
      hideConfirm: true,
      content: (
        <div className="curl-commands">
          {curlCommands.map(({ label, command }) => (
            <button
              type="button"
              className="curl-command"
              key={label}
              onClick={async () => {
                try {
                  await copyText(command);
                  toast("Command copied.", { tone: "success" });
                } catch (error) {
                  toast("Could not copy the command.", { tone: "error" });
                }
              }}
            >
              <span>
                {label} <IonIcon icon={copyOutline} />
              </span>
              <code>{command}</code>
            </button>
          ))}
        </div>
      ),
    });
  }

  async displayQRCode() {
    const qrCodeDataURL = await this.generateQRCode(window.location.href);

    if (qrCodeDataURL) {
      await showDialog({
        icon: qrCodeOutline,
        eyebrow: "Session QR code",
        title: "Open this session",
        description: "Scan to open this session on another device.",
        image: {
          src: qrCodeDataURL,
          alt: "QR code for this session",
          variant: "qr",
        },
        size: "compact",
        hideConfirm: true,
      });
    } else {
      await showDialog({
        tone: "error",
        title: "QR code unavailable",
        description:
          "The QR code could not be generated. Copy the session link instead.",
        confirmLabel: "Close",
      });
    }
  }
}

export default withRouter(Session);
