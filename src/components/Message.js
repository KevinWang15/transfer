import React from "react";
import { IonIcon } from "@ionic/react";
import { documentOutline, linkOutline } from "ionicons/icons/index.js";
import copy from "copy-to-clipboard";
import toast from "../utils/toast.js";
import { API_BASE } from "../apiclient/apiClient.js";
import "./Message.scss";
import { formatDate } from "../utils/date.js";

class Message extends React.Component {
  render() {
    switch (this.props.message.data.type) {
      case "text":
        return <TextMessage {...this.props} />;
      case "file":
        return <FileMessage {...this.props} />;
      default:
        return <div>{JSON.stringify(this.props.message.data)}</div>;
    }
  }
}

class BaseMessage extends React.Component {
  render() {
    return (
      <div className="message" style={{ whiteSpace: "pre-wrap" }}>
        <div className="datetime">
          {formatDate(new Date(this.props.message.created_at))}
        </div>
        <div className="content" onClick={this.props.onClick}>
          {this.props.renderContent()}
        </div>
      </div>
    );
  }
}

class TextMessage extends React.Component {
  render() {
    return (
      <BaseMessage
        {...this.props}
        onClick={() => {
          copy(this.props.message.data.text);
          toast("copied");
        }}
        renderContent={() => this.props.message.data.text}
      />
    );
  }
}

class FileMessage extends React.Component {
  render() {
    const url = `${API_BASE}attachments/${
      this.props.message.data.access_key
    }?fileName=${encodeURIComponent(this.props.message.data.filename)}`;
    return (
      <BaseMessage
        onClick={() => {
          window.open(url);
        }}
        {...this.props}
        renderContent={() => (
          <div
            style={{
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            <IonIcon className={"file-icon"} icon={documentOutline}></IonIcon>
            {this.props.message.data.filename}
            <IonIcon
              className={"link-icon"}
              icon={linkOutline}
              onClick={(e) => {
                e.stopPropagation();
                copy(url);
                toast("Link copied to clipboard");
              }}
            ></IonIcon>
          </div>
        )}
      />
    );
  }
}

export default Message;
