export const MAX_INLINE_IMAGE_BYTES = 12 * 1024 * 1024;

const previewableImageMimeTypes = new Map([
  ["apng", "image/apng"],
  ["avif", "image/avif"],
  ["bmp", "image/bmp"],
  ["gif", "image/gif"],
  ["ico", "image/x-icon"],
  ["jfif", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["jpg", "image/jpeg"],
  ["pjp", "image/jpeg"],
  ["pjpeg", "image/jpeg"],
  ["png", "image/png"],
  ["webp", "image/webp"],
]);

export function fileExtension(filename) {
  const name = String(filename || "");
  const separator = name.lastIndexOf(".");
  return separator > -1 && separator < name.length - 1
    ? name.slice(separator + 1).toLowerCase()
    : "";
}

export function isPreviewableImage(filename) {
  return previewableImageMimeType(filename) !== null;
}

export function previewableImageMimeType(filename) {
  return previewableImageMimeTypes.get(fileExtension(filename)) || null;
}

export function attachmentUrls(apiBase, accessKey, filename) {
  const view = `${apiBase}attachments/${encodeURIComponent(
    String(accessKey)
  )}?fileName=${encodeURIComponent(String(filename))}`;
  return {
    view,
    download: isPreviewableImage(filename) ? `${view}&download=1` : view,
  };
}

export function normalizedFileSize(size) {
  if (size === null || size === undefined || size === "") {
    return null;
  }
  const value = Number(size);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function isInlineImageSize(size) {
  const value = normalizedFileSize(size);
  return value !== null && value <= MAX_INLINE_IMAGE_BYTES;
}
