export function readBlobAsArrayBuffer(blob, FileReaderClass) {
  if (blob && typeof blob.arrayBuffer === "function") {
    return blob.arrayBuffer();
  }

  const Reader =
    FileReaderClass ||
    (typeof FileReader === "undefined" ? undefined : FileReader);
  if (!Reader) {
    return Promise.reject(
      new Error("This browser cannot read the selected file")
    );
  }

  return new Promise((resolve, reject) => {
    const reader = new Reader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () =>
      reject(reader.error || new Error("The selected file could not be read"));
    reader.onabort = () =>
      reject(new Error("Reading the selected file was cancelled"));
    reader.readAsArrayBuffer(blob);
  });
}

export function settleAll(promises) {
  return Promise.all(
    Array.from(promises, (promise) =>
      Promise.resolve(promise).then(
        (value) => ({ status: "fulfilled", value }),
        (reason) => ({ status: "rejected", reason })
      )
    )
  );
}

export function hasNativeDialogSupport(DialogClass) {
  const Candidate =
    DialogClass ||
    (typeof HTMLDialogElement === "undefined" ? undefined : HTMLDialogElement);
  return Boolean(
    Candidate &&
      Candidate.prototype &&
      typeof Candidate.prototype.showModal === "function"
  );
}
