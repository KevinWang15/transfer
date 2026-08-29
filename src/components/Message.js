import React, {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
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
  expandOutline,
  imageOutline,
  linkOutline,
  refreshOutline,
  timeOutline,
} from "ionicons/icons/index.js";
import toast from "../utils/toast.js";
import { copyText } from "../utils/clipboard.js";
import { API_BASE } from "../apiclient/apiClient.js";
import "./Message.scss";
import { formatDate } from "../utils/date.js";
import { formatBytes } from "../utils/uploadProgress.js";
import {
  attachmentUrls,
  fileExtension,
  isInlineImageSize,
  isPreviewableImage,
  normalizedFileSize,
} from "../utils/filePreview.js";

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
        label="Text message"
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
            aria-label={isCollapsible ? "Copy full message" : "Copy message"}
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
  const filename = String(message.data.filename || "attachment");
  const extension = fileExtension(filename).toUpperCase();
  const imageFile = isPreviewableImage(filename);
  const { view: viewUrl, download: downloadUrl } = attachmentUrls(
    API_BASE,
    message.data.access_key,
    filename
  );
  const storedSize = normalizedFileSize(message.data.size);
  const [resolvedSize, setResolvedSize] = useState(storedSize);
  const [previewStatus, setPreviewStatus] = useState(() => {
    if (!imageFile) {
      return "unavailable";
    }
    if (storedSize === null) {
      return "checking";
    }
    return isInlineImageSize(storedSize) ? "loading" : "unavailable";
  });

  useEffect(() => {
    const controller = new AbortController();
    setResolvedSize(storedSize);

    if (!imageFile) {
      setPreviewStatus("unavailable");
      return () => controller.abort();
    }
    if (storedSize !== null) {
      setPreviewStatus(
        isInlineImageSize(storedSize) ? "loading" : "unavailable"
      );
      return () => controller.abort();
    }

    setPreviewStatus("checking");
    window
      .fetch(viewUrl, { method: "HEAD", signal: controller.signal })
      .then((response) => {
        const responseSize = normalizedFileSize(
          response.headers.get("content-length")
        );
        if (!response.ok || !isInlineImageSize(responseSize)) {
          setPreviewStatus("unavailable");
          return;
        }
        setResolvedSize(responseSize);
        setPreviewStatus("loading");
      })
      .catch((error) => {
        if (error.name !== "AbortError") {
          setPreviewStatus("unavailable");
        }
      });
    return () => controller.abort();
  }, [imageFile, storedSize, viewUrl]);

  const openImage = () => {
    window.open(viewUrl, "_blank", "noopener,noreferrer");
  };

  const downloadFile = () => {
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = filename;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const copyLink = async () => {
    try {
      await copyText(viewUrl);
      toast("File link copied.", { tone: "success" });
    } catch (error) {
      toast("Could not copy the file link.", { tone: "error" });
    }
  };

  const showImagePreview = imageFile && previewStatus !== "unavailable";
  const fileTypeLabel = extension ? `${extension} file` : "File attachment";
  const fileDetails =
    resolvedSize === null
      ? fileTypeLabel
      : `${fileTypeLabel} · ${formatBytes(resolvedSize)}`;

  return (
    <article className="message message-file">
      <MessageMeta label="File attachment" createdAt={message.created_at} />
      <div
        className={`message-card file-message-card ${
          showImagePreview ? "has-image-preview" : ""
        }`}
      >
        {showImagePreview && (
          <button
            type="button"
            className={`image-file-preview is-${previewStatus}`}
            onClick={openImage}
            aria-label={`Open image ${filename}`}
            aria-busy={previewStatus !== "loaded"}
          >
            {previewStatus !== "loaded" && (
              <span className="image-preview-placeholder" aria-hidden="true">
                <IonIcon icon={imageOutline} />
              </span>
            )}
            {previewStatus !== "checking" && (
              <img
                src={viewUrl}
                alt={`Preview of ${filename}`}
                loading="lazy"
                decoding="async"
                draggable="false"
                onLoad={() => setPreviewStatus("loaded")}
                onError={() => setPreviewStatus("unavailable")}
              />
            )}
            {previewStatus === "loaded" && (
              <span className="image-preview-open" aria-hidden="true">
                <IonIcon icon={expandOutline} />
                Open image
              </span>
            )}
          </button>
        )}
        <div className="file-message-actions">
          <button
            type="button"
            className="message-primary-action file-primary-action"
            onClick={downloadFile}
            aria-label={`Download ${filename}`}
            title={`Download ${filename}`}
          >
            <span className="message-type-icon" aria-hidden="true">
              <IonIcon icon={imageFile ? imageOutline : documentOutline} />
            </span>
            <span className="file-message-copy">
              <strong>{filename}</strong>
              <span>{fileDetails}</span>
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
