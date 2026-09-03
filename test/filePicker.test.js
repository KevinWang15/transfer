import assert from "node:assert/strict";
import test from "node:test";

import {
  openFileInput,
  takeFileInputSelection,
} from "../src/utils/filePicker.js";

test("opening the mounted input clears an earlier selection before clicking", () => {
  const actions = [];
  const input = {
    _value: "C:\\fakepath\\first.jpg",
    get value() {
      return this._value;
    },
    set value(value) {
      this._value = value;
      actions.push(`value:${value}`);
    },
    click() {
      actions.push("click");
    },
  };

  assert.equal(openFileInput(input), true);
  assert.deepEqual(actions, ["value:", "click"]);
  assert.equal(openFileInput(null), false);
});

test("file input selections are snapshotted and the input is cleared", () => {
  const first = { name: "first.jpg", size: 100 };
  const second = { name: "second.jpg", size: 200 };
  const input = {
    files: { 0: first, 1: second, length: 2 },
    value: "C:\\fakepath\\first.jpg",
  };

  const files = takeFileInputSelection(input);

  assert.deepEqual(files, [first, second]);
  assert.equal(input.value, "");

  input.files = { length: 0 };
  assert.deepEqual(files, [first, second]);
});

test("an empty or missing file input selection is safe", () => {
  assert.deepEqual(takeFileInputSelection(null), []);

  const input = { files: null, value: "" };
  assert.deepEqual(takeFileInputSelection(input), []);
  assert.equal(input.value, "");
});
