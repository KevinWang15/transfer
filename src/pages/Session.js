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
  codeSlashSharp,
  documentOutline,
  paperPlaneOutline,
  qrCodeSharp,
} from "ionicons/icons/index.js";
import QRCode from "qrcode";
import sweetalert2 from "sweetalert2";
import copy from "copy-to-clipboard";
import { createRoot } from "react-dom/client";
import { stripTrailingSlash } from "../utils/utils.js";

class Session extends React.Component {
  state = {
    messages: [],
    textboxText: "",
    serversideConfig: null,
  };

  socket = null;

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

  async deleteEverythingInThisSession() {
    if (
      // eslint-disable-next-line no-restricted-globals
      !confirm(
        "Are you sure you want to delete everything in this session? This action cannot be undone."
      )
    ) {
      return;
    }

    await ApiClient.deleteEverythingInSession(this.props.router.params.id);
    toast("deleted");
    this.setState({ messages: [] });
  }

  async uploadFiles(files) {
    for (let inputFile of files) {
      await ApiClient.uploadAttachment(inputFile, {
        name: inputFile.name,
        sessionId: this.props.router.params.id,
      });
    }
  }

  sendTextMessage = async () => {
    if (!this.state.textboxText) {
      return;
    }
    await ApiClient.sendText(this.state.textboxText, {
      sessionId: this.props.router.params.id,
    });
    this.setState({ textboxText: "" });
  };

  constructor(props) {
    super(props);
    this.socket = io(`${WEBSOCKET_BASE}`, {
      extraHeaders: {
        sessionId: props.router.params.id,
      },
    });

    this.socket.on("connect", () => {
      toast("connected");
      this.loadSessionHistory();
    });

    this.socket.on("disconnect", () => {
      toast("disconnected");
    });

    this.socket.on(NEW_MESSAGE, (...args) => {
      this.setState(
        {
          messages: [...this.state.messages, args[0]],
        },
        this.scrollToBottom
      );
    });
  }

  socketOps = {
    postMessage: (message) => {
      this.socket.emit(POST_MESSAGE, message);
    },
  };

  removeDragDropListener = () => {
    throw "why??";
  };

  componentDidMount() {
    ApiClient.getServerSideConfig().then((serversideConfig) => {
      this.setState({ serversideConfig });
    });
    this.addDragDropListener();
  }

  componentWillUnmount() {
    this.removeDragDropListener();
  }

  scrollToBottom() {
    const main = document.getElementsByClassName("session-main")[0];

    // scroll smoothly to the bottom
    main.scrollTo({
      top: main.scrollHeight,
      behavior: "smooth",
    });
  }

  render() {
    return (
      <>
        <header>
          <nav className="navbar navbar-expand-md navbar-dark fixed-top bg-dark justify-content-between">
            <span className={"title"}>{this.props.router.params.id}</span>
            <span className={"button"}>
              <IonIcon
                onClick={() => this.displayCurlCmd()}
                icon={codeSlashSharp}
              ></IonIcon>
              <IonIcon
                onClick={() => this.displayQRCode()}
                icon={qrCodeSharp}
              ></IonIcon>
            </span>
          </nav>
        </header>

        <main className="session-main">
          <div className="container">
            {this.state.messages.map((message) => (
              <Message message={message} key={message.id} />
            ))}
          </div>

          <div style={{ height: 36 }}></div>
        </main>

        <footer className="session-footer container">
          <div className="container">
            <div className="row">
              {!!this.state.serversideConfig && (
                <div className={"message-retention-warning"}>
                  Only the most recent{" "}
                  {this.state.serversideConfig.messagesToKeep.maxCount} messages
                  within a{" "}
                  {this.state.serversideConfig.messagesToKeep.ttl / 86400}-day
                  window are preserved <br />
                  <a
                    href="#"
                    onClick={() => this.deleteEverythingInThisSession()}
                  >
                    Delete everything in this session immediately
                  </a>
                </div>
              )}
              <div className="col flex-column flex-grow-0">
                <button
                  className="send-file-btn btn btn-sm btn-secondary"
                  onClick={() => this.sendFile()}
                >
                  <IonIcon icon={documentOutline}></IonIcon>
                </button>
              </div>
              <div className="col flex-column flex-grow-1">
                <textarea
                  className="form-control"
                  rows="2"
                  style={{ resize: "none" }}
                  value={this.state.textboxText}
                  onKeyDown={(e) => {
                    if (e.keyCode === 13 && e.metaKey) {
                      this.sendTextMessage();
                    }
                  }}
                  onChange={(e) =>
                    this.setState({
                      textboxText: e.target.value,
                    })
                  }
                ></textarea>
              </div>

              <div className="col flex-column flex-grow-0">
                <button
                  className="send-text-btn btn btn-sm btn-primary"
                  onClick={() => this.sendTextMessage()}
                >
                  <IonIcon icon={paperPlaneOutline}></IonIcon>
                </button>
              </div>
            </div>
          </div>
        </footer>
      </>
    );
  }

  loadSessionHistory() {
    ApiClient.loadSessionHistory(this.props.router.params.id).then(
      (messages) => {
        this.setState(
          {
            messages,
          },
          this.scrollToBottom
        );
      }
    );
  }

  addDragDropListener = () => {
    let dragoverListener = function (event) {
      event.preventDefault();
    };
    document.addEventListener("dragover", dragoverListener);

    let dropListener = (event) => {
      event.preventDefault();
      this.uploadFiles(event.dataTransfer.files);
    };
    document.addEventListener("drop", dropListener);

    this.removeDragDropListener = () => {
      document.removeEventListener("dragover", dragoverListener);
      document.removeEventListener("drop", dropListener);
    };
  };

  async generateQRCode(url) {
    try {
      const canvas = await QRCode.toCanvas(url, {
        width: 360 * 2,
      });
      return canvas.toDataURL(); // Convert the canvas to a data URL
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
      title: swalContent,
      didOpen: () => {
        reactRoot = createRoot(swalContent);
        reactRoot.render(
          <div className="curl-commands">
            <p>
              Send messages to this session using the following curl command:
            </p>
            <pre
              onClick={() => {
                copy(sendTextCurl);
                toast("Copied to clipboard");
              }}
            >
              {sendTextCurl}
            </pre>
            <hr />
            <p>Send a file to this session using the following curl command:</p>
            <pre
              onClick={() => {
                copy(sendFileCurl);
                toast("Copied to clipboard");
              }}
            >
              {sendFileCurl}
            </pre>
          </div>
        );
      },
      willClose: () => {
        reactRoot.unmount();
      },
    });
  }

  async displayQRCode() {
    const url = window.location.href;
    const qrCodeDataURL = await this.generateQRCode(url);

    if (qrCodeDataURL) {
      sweetalert2.fire({
        imageUrl: qrCodeDataURL,
        imageWidth: 360,
        title: "Scan this QR code to join the session",
        showCloseButton: true,
      });
    } else {
      sweetalert2.fire({
        icon: "error",
        title: "Error",
        text: "Unable to generate QR code.",
      });
    }
  }
}

export default withRouter(Session);
