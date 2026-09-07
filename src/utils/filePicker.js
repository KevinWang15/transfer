export function createFilePicker(container, onFiles, onError, onDiagnostic) {
  const selections = new Set();
  let pendingPicker = null;
  let disposed = false;
  let nextPickerId = 0;

  const report = (event, selection, details = {}) => {
    if (onDiagnostic) {
      onDiagnostic(event, {
        picker: selection?.id,
        connected: selection?.input.isConnected,
        accepted: selection?.accepted,
        fileCount: selection?.input.files?.length,
        ...details,
      });
    }
  };

  function release(selection, reason) {
    report("picker-release", selection, { reason });
    selection.input.removeEventListener("input", selection.accept);
    selection.input.removeEventListener("change", selection.accept);
    selection.input.removeEventListener("cancel", selection.cancel);
    selection.input.remove();
    selections.delete(selection);
    if (pendingPicker === selection) {
      pendingPicker = null;
    }
  }

  return {
    open() {
      if (disposed || !container?.isConnected) {
        report("picker-open-blocked", null, {
          disposed,
          hostConnected: Boolean(container?.isConnected),
        });
        return false;
      }

      // A new user gesture means any earlier, unsubmitted picker was dismissed.
      // Older browsers do not emit cancel when the native picker closes.
      if (pendingPicker) {
        release(pendingPicker, "replaced-unsubmitted-picker");
      }

      const input = container.ownerDocument.createElement("input");
      input.type = "file";
      input.multiple = true;
      input.className = "session-file-input";
      input.tabIndex = -1;
      input.setAttribute("aria-hidden", "true");

      const selection = { id: ++nextPickerId, input, accepted: false };
      selection.accept = (event) => {
        report("picker-event", selection, { type: event.type });
        if (selection.accepted || disposed) {
          return;
        }
        const files = Array.from(input.files || []);
        if (!files.length) {
          return;
        }

        selection.accepted = true;
        pendingPicker = null;
        report("picker-selection-accepted", selection, {
          sizes: files.map((file) => file.size),
        });
        // Keep this input and its native selection intact while Files are read.
        // Each subsequent opening gets a separate input, even during an upload.
        // Listen to both native events, but enqueue each selection only once.
        Promise.resolve()
          .then(() => {
            if (!disposed) {
              report("picker-deliver-to-queue", selection);
              return onFiles(files);
            }
          })
          .catch((error) => {
            if (!disposed) {
              report("picker-selection-error", selection, {
                error: error.name,
              });
              onError(error);
            }
          })
          .finally(() => release(selection, "batch-settled"));
      };
      selection.cancel = () => {
        report("picker-event", selection, { type: "cancel" });
        if (!selection.accepted) {
          release(selection, "cancel");
        }
      };

      selections.add(selection);
      pendingPicker = selection;
      input.addEventListener("input", selection.accept);
      input.addEventListener("change", selection.accept);
      input.addEventListener("cancel", selection.cancel);
      container.appendChild(input);
      report("picker-open", selection);
      try {
        // Must stay synchronous with the button's user gesture on iOS.
        input.click();
      } catch (error) {
        report("picker-open-error", selection, { error: error.name });
        release(selection, "open-error");
        onError(error);
        return false;
      }
      return true;
    },

    inspect() {
      report("picker-inspect", null, {
        retainedInputs: selections.size,
        pendingPicker: pendingPicker?.id,
        disposed,
      });
      selections.forEach((selection) => report("picker-snapshot", selection));
    },

    dispose() {
      disposed = true;
      selections.forEach((selection) => release(selection, "disposed"));
    },
  };
}
