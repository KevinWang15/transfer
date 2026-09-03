export function openFileInput(input) {
  if (!input) {
    return false;
  }

  // Reset before opening so selecting the same files again still emits change.
  input.value = "";
  input.click();
  return true;
}

export function takeFileInputSelection(input) {
  const files = Array.from(input?.files || []);

  if (input) {
    // File inputs can only be cleared programmatically. Clearing after taking a
    // snapshot also releases the picker state without invalidating our Files.
    input.value = "";
  }

  return files;
}
