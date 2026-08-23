export const MAX_INLINE_IMAGE_BYTES = 12 * 1024 * 1024;

const previewableImageExtensions = new Set([
  "apng",
  "avif",
  "bmp",
  "gif",
  "ico",
  "jfif",
  "jpeg",
  "jpg",
  "pjp",
  "pjpeg",
  "png",
  "webp",
]);

export function fileExtension(filename) {
  const name = String(filename || "");
  const separator = name.lastIndexOf(".");
  return separator > -1 && separator < name.length - 1
    ? name.slice(separator + 1).toLowerCase()
    : "";
}

export function isPreviewableImage(filename) {
  return previewableImageExtensions.has(fileExtension(filename));
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
