import React from "react";
import { IonIcon } from "@ionic/react";
import {
  copyOutline,
  documentOutline,
  documentTextOutline,
  downloadOutline,
  linkOutline,
} from "ionicons/icons/index.js";
import copy from "copy-to-clipboard";
import toast from "../utils/toast.js";
import { API_BASE } from "../apiclient/apiClient.js";
import "./Message.scss";
import { formatDate } from "../utils/date.js";

export default function Message({ message }) {
  switch (message.data.type) {
    case "text":
      return <TextMessage message={message} />;
    case "file":
      return <FileMessage message={message} />;
    default:
      return <UnknownMessage message={message} />;
  }
}

function MessageMeta({ label, createdAt }) {
  const createdDate = new Date(createdAt);
  return (
    <div className="message-meta">
      <span>{label}</span>
      <time dateTime={createdDate.toISOString()}>
        {formatDate(createdDate)}
      </time>
    </div>
  );
}

function TextMessage({ message }) {
  const copyText = () => {
    copy(message.data.text);
    toast("Message copied.");
  };

  return (
    <article className="message message-text">
      <MessageMeta label="Shared note" createdAt={message.created_at} />
      <button
        type="button"
        className="message-card message-primary-action"
        onClick={copyText}
        aria-label="Copy shared note"
      >
        <span className="message-type-icon" aria-hidden="true">
          <IonIcon icon={documentTextOutline} />
        </span>
        <span className="message-text-content">{message.data.text}</span>
        <span className="message-trailing-icon" aria-hidden="true">
          <IonIcon icon={copyOutline} />
        </span>
      </button>
    </article>
  );
}

function FileMessage({ message }) {
  const filename = message.data.filename;
  const url = `${API_BASE}attachments/${
    message.data.access_key
  }?fileName=${encodeURIComponent(filename)}`;
  const extension = filename.includes(".")
    ? filename.split(".").pop().toUpperCase()
    : null;

  const openFile = () => {
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const copyLink = () => {
    copy(url);
    toast("File link copied.");
  };

  return (
    <article className="message message-file">
      <MessageMeta label="File attachment" createdAt={message.created_at} />
      <div className="message-card file-message-card">
        <button
          type="button"
          className="message-primary-action file-primary-action"
          onClick={openFile}
          title={filename}
        >
          <span className="message-type-icon" aria-hidden="true">
            <IonIcon icon={documentOutline} />
          </span>
          <span className="file-message-copy">
            <strong>{filename}</strong>
            <span>{extension ? `${extension} file` : "File attachment"}</span>
          </span>
          <span className="message-trailing-icon" aria-hidden="true">
            <IonIcon icon={downloadOutline} />
          </span>
        </button>
        <button
          type="button"
          className="file-copy-action"
          onClick={copyLink}
          aria-label={`Copy link to ${filename}`}
          title="Copy file link"
        >
          <IonIcon icon={linkOutline} />
        </button>
      </div>
    </article>
  );
}

function UnknownMessage({ message }) {
  return (
    <article className="message message-unknown">
      <MessageMeta label="Session update" createdAt={message.created_at} />
      <div className="message-card">
        <pre>{JSON.stringify(message.data, null, 2)}</pre>
      </div>
    </article>
  );
}
