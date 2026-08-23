import React, { useId, useLayoutEffect, useRef, useState } from "react";
import { IonIcon } from "@ionic/react";
import {
  alertCircleOutline,
  checkmarkCircleOutline,
  chevronDownOutline,
  chevronUpOutline,
  copyOutline,
  createOutline,
  documentOutline,
  documentTextOutline,
  downloadOutline,
  linkOutline,
  refreshOutline,
  timeOutline,
} from "ionicons/icons/index.js";
import toast from "../utils/toast.js";
import { copyText } from "../utils/clipboard.js";
import { API_BASE } from "../apiclient/apiClient.js";
import "./Message.scss";
import { formatDate } from "../utils/date.js";

export default function Message({ message, onRetry, onEdit }) {
  switch (message.data.type) {
    case "text":
      return (
        <TextMessage message={message} onRetry={onRetry} onEdit={onEdit} />
      );
    case "file":
      return <FileMessage message={message} />;
    default:
      return <UnknownMessage message={message} />;
  }
}

const deliveryMeta = {
  sending: { icon: timeOutline, label: "Sending" },
  sent: { icon: checkmarkCircleOutline, label: "Sent" },
  failed: { icon: alertCircleOutline, label: "Not sent" },
};

function MessageMeta({ label, createdAt, deliveryStatus }) {
  const createdDate = new Date(createdAt);
  const delivery = deliveryMeta[deliveryStatus];
  return (
    <div className="message-meta">
      <span
        className={delivery ? `message-state-label ${deliveryStatus}` : ""}
        role={delivery ? "status" : undefined}
      >
        {delivery && <IonIcon icon={delivery.icon} aria-hidden="true" />}
        {delivery?.label || label}
      </span>
      <time dateTime={createdDate.toISOString()}>
        {formatDate(createdDate)}
      </time>
    </div>
  );
}

function TextMessage({ message, onRetry, onEdit }) {
  const deliveryStatus = message.deliveryStatus;
  const text = String(message.data.text ?? "");
  const contentId = useId();
  const viewportRef = useRef(null);
  const [isCollapsible, setIsCollapsible] = useState(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const isCollapsed = !isExpanded && isCollapsible !== false;
  const lineCount = text.split(/\r\n?|\n/).length;
  const extentLabel =
    lineCount > 1
      ? `${lineCount.toLocaleString()} lines`
      : `${text.length.toLocaleString()} characters`;

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return undefined;
    }

    setIsExpanded(false);
    const measure = () => {
      const lineHeight = Number.parseFloat(
        window.getComputedStyle(viewport).lineHeight
      );
      const collapsedHeight = lineHeight * 10;
      setIsCollapsible(viewport.scrollHeight > collapsedHeight + 1);
    };
    measure();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }

    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [text]);

  const copyMessage = async () => {
    try {
      await copyText(text);
      toast("Message copied.", { tone: "success" });
    } catch (error) {
      toast("Could not copy the message.", { tone: "error" });
    }
  };

  return (
    <article
      className={`message message-text ${
        deliveryStatus ? `delivery-${deliveryStatus}` : ""
      }`}
    >
      <MessageMeta
        label="Shared note"
        createdAt={message.created_at}
        deliveryStatus={deliveryStatus}
      />
      <div
        className={`message-card text-message-card ${
          isCollapsible ? "has-overflow" : ""
        } ${isExpanded ? "is-expanded" : ""}`}
      >
        <div className="message-primary-action text-message-layout">
          <span className="message-type-icon" aria-hidden="true">
            <IonIcon icon={documentTextOutline} />
          </span>
          <span
            ref={viewportRef}
            className={`message-text-viewport ${
              isCollapsed ? "is-collapsed" : "is-expanded"
            }`}
          >
            <span id={contentId} className="message-text-content">
              {text}
            </span>
          </span>
          <button
            type="button"
            className="message-copy-action"
            onClick={copyMessage}
            aria-label={
              isCollapsible ? "Copy full shared note" : "Copy shared note"
            }
            title="Copy message"
          >
            <IonIcon icon={copyOutline} />
          </button>
        </div>
        {isCollapsible && (
          <button
            type="button"
            className="message-expand-action"
            onClick={() => {
              if (isExpanded) {
                viewportRef.current?.scrollTo({ top: 0 });
              }
              setIsExpanded((current) => !current);
            }}
            aria-expanded={isExpanded}
            aria-controls={contentId}
          >
            <span>
              <IonIcon
                icon={isExpanded ? chevronUpOutline : chevronDownOutline}
              />
              {isExpanded ? "Collapse message" : "Show full message"}
            </span>
            <small>{extentLabel}</small>
          </button>
        )}
      </div>
      {deliveryStatus === "failed" && (
        <div className="message-failure-actions">
          <span>The message didn’t reach the server.</span>
          <div>
            <button type="button" onClick={() => onEdit?.(message)}>
              <IonIcon icon={createOutline} />
              Edit
            </button>
            <button
              type="button"
              className="retry-message"
              onClick={() => onRetry?.(message)}
            >
              <IonIcon icon={refreshOutline} />
              Retry
            </button>
          </div>
        </div>
      )}
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

  const copyLink = async () => {
    try {
      await copyText(url);
      toast("File link copied.", { tone: "success" });
    } catch (error) {
      toast("Could not copy the file link.", { tone: "error" });
    }
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
