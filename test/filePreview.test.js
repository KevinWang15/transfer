import assert from "node:assert/strict";
import test from "node:test";

import {
  fileExtension,
  isInlineImageSize,
  isPreviewableImage,
  MAX_INLINE_IMAGE_BYTES,
  normalizedFileSize,
} from "../src/utils/filePreview.js";

test("browser-safe raster image names are eligible for inline previews", () => {
  assert.equal(fileExtension("holiday.photo.JPEG"), "jpeg");
  assert.equal(isPreviewableImage("holiday.photo.JPEG"), true);
  assert.equal(isPreviewableImage("animation.webp"), true);
  assert.equal(isPreviewableImage("vector.svg"), false);
  assert.equal(isPreviewableImage("photo.png.exe"), false);
});

test("automatic image previews have a strict file-size ceiling", () => {
  assert.equal(isInlineImageSize(MAX_INLINE_IMAGE_BYTES), true);
  assert.equal(isInlineImageSize(MAX_INLINE_IMAGE_BYTES + 1), false);
  assert.equal(isInlineImageSize(null), false);
  assert.equal(normalizedFileSize("4096"), 4096);
  assert.equal(normalizedFileSize(-1), null);
});
