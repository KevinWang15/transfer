export const UPLOAD_DIAGNOSTICS_VERSION = "ios26-trace-1";

export function createUploadDiagnostics({
  enabled = false,
  now = Date.now,
} = {}) {
  const startedAt = now();
  const events = [];
  let sequence = 0;

  return {
    enabled,
    record(event, details = {}) {
      if (!enabled) {
        return;
      }
      events.push({
        sequence: ++sequence,
        ms: now() - startedAt,
        event,
        ...details,
      });
      if (events.length > 200) {
        events.shift();
      }
    },
    getText() {
      return JSON.stringify(
        { version: UPLOAD_DIAGNOSTICS_VERSION, events },
        null,
        2
      );
    },
  };
}
