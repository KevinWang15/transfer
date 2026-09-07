import React, { useState } from "react";
import { copyText } from "../utils/clipboard.js";
import { UPLOAD_DIAGNOSTICS_VERSION } from "../utils/uploadDiagnostics.js";
import "./UploadDiagnostics.scss";

export default function UploadDiagnostics({ capture }) {
  const [text, setText] = useState("");
  const [status, setStatus] = useState("");

  const refresh = () => {
    const nextText = capture();
    setText(nextText);
    setStatus("");
    return nextText;
  };

  return (
    <details
      className="upload-diagnostics"
      onToggle={(event) => {
        if (event.currentTarget.open) refresh();
      }}
    >
      <summary>Upload diagnostics · {UPLOAD_DIAGNOSTICS_VERSION}</summary>
      <p>
        Reproduce the missing upload, then copy the log. The log stays on this
        page and excludes filenames and file contents.
      </p>
      <div>
        <button
          type="button"
          onClick={async () => {
            const nextText = refresh();
            try {
              await copyText(nextText);
              setStatus("Copied. Paste the log into the conversation.");
            } catch {
              setStatus("Select and copy the text below.");
            }
          }}
        >
          Copy upload log
        </button>
        <button type="button" onClick={refresh}>
          Refresh log
        </button>
      </div>
      <span role="status">{status}</span>
      <textarea
        aria-label="Upload diagnostic log"
        value={text}
        readOnly
        spellCheck={false}
      />
    </details>
  );
}
