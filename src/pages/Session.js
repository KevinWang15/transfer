import React from "react";
import withRouter from "../utils/withRouter.js";
import { io } from "socket.io-client";
import ApiClient, { WEBSOCKET_BASE } from "../apiclient/apiClient.js";
import {
  NEW_MESSAGE,
  POST_MESSAGE,
} from "@transfer/api/consts/socketEvents.js";
import toast from "../utils/toast.js";
import "./Session.scss";
import Message from "../components/Message.js";
import { IonIcon } from "@ionic/react";
import { documentOutline, paperPlaneOutline } from "ionicons/icons/index.js";

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

  async uploadFiles(files) {
    for (let inputFile of files) {
      const uploadFileResp = await ApiClient.uploadAttachment(inputFile);
      if (uploadFileResp.success) {
        this.socketOps.postMessage({
          type: "file",
          filename: inputFile.name,
          access_key: uploadFileResp.filename,
        });
      }
    }
  }

  sendTextMessage = () => {
    if (!this.state.textboxText) {
      return;
    }
    this.socketOps.postMessage({
      type: "text",
      text: this.state.textboxText,
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
          <nav className="navbar navbar-expand-md navbar-dark fixed-top bg-dark">
            <div className="container-fluid">
              <span className="navbar-brand">
                {this.props.router.params.id}
              </span>
            </div>
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
                  Only the most recent {this.state.serversideConfig.messagesToKeep.maxCount} messages within a {this.state.serversideConfig.messagesToKeep.ttl/86400}-day window are preserved
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
}

export default withRouter(Session);
