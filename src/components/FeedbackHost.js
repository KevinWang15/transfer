import React, { useCallback, useEffect, useRef, useState } from "react";
import { IonIcon } from "@ionic/react";
import {
  alertCircleOutline,
  checkmarkCircleOutline,
  closeOutline,
  informationCircleOutline,
  notificationsOutline,
} from "ionicons/icons/index.js";
import { subscribeToFeedback } from "../utils/feedback.js";
import { hasNativeDialogSupport } from "../utils/browserCompatibility.js";
import "./FeedbackHost.scss";

const toneIcons = {
  danger: alertCircleOutline,
  error: alertCircleOutline,
  success: checkmarkCircleOutline,
  warning: alertCircleOutline,
  info: informationCircleOutline,
  neutral: notificationsOutline,
};

export default function FeedbackHost() {
  const [dialogs, setDialogs] = useState([]);
  const [toasts, setToasts] = useState([]);

  useEffect(
    () =>
      subscribeToFeedback((event) => {
        if (event.type === "dialog") {
          setDialogs((current) => [...current, event.dialog]);
        } else if (event.type === "toast") {
          setToasts((current) => [...current, event.toast].slice(-4));
        }
      }),
    []
  );

  const dismissToast = useCallback((id) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const resolveDialog = useCallback((id, result) => {
    setDialogs((current) => {
      const dialog = current.find((candidate) => candidate.id === id);
      dialog?.resolve(result);
      return current.filter((candidate) => candidate.id !== id);
    });
  }, []);

  const toastRegion = (
    <div
      className="feedback-toast-region"
      aria-label="Notifications"
      aria-live="polite"
    >
      {toasts.map((toast) => (
        <FeedbackToast toast={toast} key={toast.id} onDismiss={dismissToast} />
      ))}
    </div>
  );

  return (
    <>
      {!dialogs[0] && toastRegion}
      {dialogs[0] && (
        <FeedbackDialog
          dialog={dialogs[0]}
          key={dialogs[0].id}
          onResolve={resolveDialog}
          toastRegion={toastRegion}
        />
      )}
    </>
  );
}

function FeedbackToast({ toast, onDismiss }) {
  const [paused, setPaused] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const timeoutRef = useRef(null);
  const remainingRef = useRef(toast.duration);
  const startedAtRef = useRef(Date.now());

  const dismiss = useCallback(() => {
    if (leaving) {
      return;
    }
    window.clearTimeout(timeoutRef.current);
    setLeaving(true);
    window.setTimeout(() => onDismiss(toast.id), 180);
  }, [leaving, onDismiss, toast.id]);

  const resume = useCallback(() => {
    if (!paused) {
      return;
    }
    setPaused(false);
    startedAtRef.current = Date.now();
    timeoutRef.current = window.setTimeout(dismiss, remainingRef.current);
  }, [dismiss, paused]);

  const pause = useCallback(() => {
    if (paused) {
      return;
    }
    window.clearTimeout(timeoutRef.current);
    remainingRef.current = Math.max(
      0,
      remainingRef.current - (Date.now() - startedAtRef.current)
    );
    setPaused(true);
  }, [paused]);

  useEffect(() => {
    if (leaving) {
      return undefined;
    }
    startedAtRef.current = Date.now();
    timeoutRef.current = window.setTimeout(dismiss, remainingRef.current);
    return () => window.clearTimeout(timeoutRef.current);
  }, [dismiss, leaving]);

  const icon = toneIcons[toast.tone] || toneIcons.neutral;
  return (
    <article
      className={`feedback-toast tone-${toast.tone} ${
        leaving ? "is-leaving" : ""
      }`}
      role={toast.tone === "error" ? "alert" : "status"}
      onMouseEnter={pause}
      onMouseLeave={resume}
    >
      <span className="feedback-toast-icon" aria-hidden="true">
        <IonIcon icon={icon} />
      </span>
      <span className="feedback-toast-copy">
        {toast.title && <strong>{toast.title}</strong>}
        <span>{toast.message}</span>
      </span>
      <button type="button" onClick={dismiss} aria-label="Dismiss notification">
        <IonIcon icon={closeOutline} />
      </button>
      <span
        className={`feedback-toast-timer ${paused ? "is-paused" : ""}`}
        style={{ animationDuration: `${toast.duration}ms` }}
        aria-hidden="true"
      />
    </article>
  );
}

function FeedbackDialog({ dialog, onResolve, toastRegion }) {
  const { options } = dialog;
  const dialogRef = useRef(null);
  const inputRef = useRef(null);
  const confirmRef = useRef(null);
  const cancelRef = useRef(null);
  const closeRef = useRef(null);
  const restoreFocusRef = useRef(document.activeElement);
  const [inputValue, setInputValue] = useState(
    options.input?.defaultValue || ""
  );
  const [validationError, setValidationError] = useState("");
  const titleId = `feedback-dialog-title-${dialog.id}`;
  const descriptionId = `feedback-dialog-description-${dialog.id}`;
  const errorId = `feedback-dialog-error-${dialog.id}`;
  const supportsNativeDialog = hasNativeDialogSupport();

  const dismiss = useCallback(() => {
    if (options.dismissible === false) {
      return;
    }
    onResolve(dialog.id, { isConfirmed: false, value: null });
  }, [dialog.id, onResolve, options.dismissible]);

  const confirm = useCallback(() => {
    const error = options.validate?.(inputValue);
    if (error) {
      setValidationError(error);
      inputRef.current?.focus();
      return;
    }
    onResolve(dialog.id, { isConfirmed: true, value: inputValue });
  }, [dialog.id, inputValue, onResolve, options]);

  useEffect(() => {
    const element = dialogRef.current;
    const previousBodyOverflow = document.body.style.overflow;
    if (supportsNativeDialog && !element.open) {
      element.showModal();
    } else if (!supportsNativeDialog) {
      document.body.style.overflow = "hidden";
    }
    window.requestAnimationFrame(() => {
      const preferredAction =
        options.tone === "danger" ? cancelRef.current : confirmRef.current;
      (
        inputRef.current ||
        preferredAction ||
        closeRef.current ||
        element
      ).focus();
    });
    const restoreFocus = restoreFocusRef.current;
    return () => {
      if (
        supportsNativeDialog &&
        element.open &&
        typeof element.close === "function"
      ) {
        element.close();
      }
      if (!supportsNativeDialog) {
        document.body.style.overflow = previousBodyOverflow;
      }
      restoreFocus?.focus?.();
    };
  }, [options.tone, supportsNativeDialog]);

  const handleFallbackKeyDown = (event) => {
    if (supportsNativeDialog) {
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      dismiss();
      return;
    }
    if (event.key !== "Tab") {
      return;
    }

    const element = dialogRef.current;
    const focusable = Array.from(
      element.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    ).filter((candidate) => !candidate.hidden);
    if (!focusable.length) {
      event.preventDefault();
      element.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const tone = options.tone || "neutral";
  const icon = options.icon || toneIcons[tone] || toneIcons.neutral;
  const hasFooter = !options.hideConfirm || options.showCancel;
  const DialogElement = supportsNativeDialog ? "dialog" : "div";
  const dialogCompatibilityProps = supportsNativeDialog
    ? {
        onCancel: (event) => {
          event.preventDefault();
          dismiss();
        },
      }
    : { role: "dialog", "aria-modal": "true" };

  return (
    <div
      className="feedback-dialog-layer"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          dismiss();
        }
      }}
    >
      <DialogElement
        ref={dialogRef}
        className={`feedback-dialog tone-${tone} size-${
          options.size || "default"
        }`}
        tabIndex="-1"
        aria-labelledby={titleId}
        aria-describedby={options.description ? descriptionId : undefined}
        {...dialogCompatibilityProps}
        onKeyDown={handleFallbackKeyDown}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            dismiss();
          }
        }}
      >
        {toastRegion}
        <form
          method="dialog"
          className="feedback-dialog-surface"
          onSubmit={(event) => {
            event.preventDefault();
            confirm();
          }}
        >
          {options.showClose !== false && (
            <button
              ref={closeRef}
              type="button"
              className="feedback-dialog-close"
              onClick={dismiss}
              aria-label="Close dialog"
            >
              <IonIcon icon={closeOutline} />
            </button>
          )}

          <div className="feedback-dialog-heading">
            {icon && (
              <span className="feedback-dialog-icon" aria-hidden="true">
                <IonIcon icon={icon} />
              </span>
            )}
            <div>
              {options.eyebrow && <span>{options.eyebrow}</span>}
              <h2 id={titleId}>{options.title}</h2>
            </div>
          </div>

          {options.description && (
            <p id={descriptionId} className="feedback-dialog-description">
              {options.description}
            </p>
          )}

          {options.image && (
            <div
              className={`feedback-dialog-image ${
                options.image.variant || "preview"
              }`}
            >
              <img src={options.image.src} alt={options.image.alt || ""} />
            </div>
          )}

          {options.input && (
            <label className="feedback-dialog-field">
              <span>{options.input.label}</span>
              <input
                ref={inputRef}
                type={options.input.type || "text"}
                value={inputValue}
                placeholder={options.input.placeholder}
                autoComplete={options.input.autoComplete || "off"}
                autoCapitalize={options.input.autoCapitalize || "off"}
                spellCheck={options.input.spellCheck ?? false}
                maxLength={options.input.maxLength}
                aria-invalid={Boolean(validationError)}
                aria-describedby={validationError ? errorId : undefined}
                onChange={(event) => {
                  setInputValue(event.target.value);
                  if (validationError) {
                    setValidationError("");
                  }
                }}
              />
              {validationError && (
                <span
                  id={errorId}
                  className="feedback-dialog-error"
                  role="alert"
                >
                  <IonIcon icon={alertCircleOutline} />
                  {validationError}
                </span>
              )}
            </label>
          )}

          {options.content && (
            <div className="feedback-dialog-content">{options.content}</div>
          )}

          {hasFooter && (
            <div className="feedback-dialog-actions">
              {options.showCancel && (
                <button
                  ref={cancelRef}
                  type="button"
                  className="secondary"
                  onClick={dismiss}
                >
                  {options.cancelLabel || "Cancel"}
                </button>
              )}
              {!options.hideConfirm && (
                <button ref={confirmRef} type="submit" className="primary">
                  {options.confirmLabel || "Continue"}
                </button>
              )}
            </div>
          )}
        </form>
      </DialogElement>
    </div>
  );
}
