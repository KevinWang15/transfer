import assert from "node:assert/strict";
import test from "node:test";

import {
  attachmentUrls,
  fileExtension,
  isInlineImageSize,
  isPreviewableImage,
  MAX_INLINE_IMAGE_BYTES,
  normalizedFileSize,
  previewableImageMimeType,
} from "../src/utils/filePreview.js";

test("browser-safe raster image names are eligible for inline previews", () => {
  assert.equal(fileExtension("holiday.photo.JPEG"), "jpeg");
  assert.equal(isPreviewableImage("holiday.photo.JPEG"), true);
  assert.equal(isPreviewableImage("animation.webp"), true);
  assert.equal(isPreviewableImage("vector.svg"), false);
  assert.equal(isPreviewableImage("photo.png.exe"), false);
  assert.equal(previewableImageMimeType("holiday.photo.JPEG"), "image/jpeg");
  assert.equal(previewableImageMimeType("vector.svg"), null);
});

test("only image downloads receive an explicit download URL", () => {
  const image = attachmentUrls(
    "https://transfer.example/",
    "image key",
    "photo one.png"
  );
  assert.equal(
    image.view,
    "https://transfer.example/attachments/image%20key?fileName=photo%20one.png"
  );
  assert.equal(image.download, `${image.view}&download=1`);

  const document = attachmentUrls(
    "https://transfer.example/",
    "document-key",
    "report.pdf"
  );
  assert.equal(document.download, document.view);
});

test("automatic image previews have a strict file-size ceiling", () => {
  assert.equal(isInlineImageSize(MAX_INLINE_IMAGE_BYTES), true);
  assert.equal(isInlineImageSize(MAX_INLINE_IMAGE_BYTES + 1), false);
  assert.equal(isInlineImageSize(null), false);
  assert.equal(normalizedFileSize("4096"), 4096);
  assert.equal(normalizedFileSize(-1), null);
});
