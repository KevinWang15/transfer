import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

import { createFilePicker } from "../src/utils/filePicker.js";

const tick = () => new Promise((resolve) => setImmediate(resolve));

function setup(t, onFiles, diagnostics = false) {
  const dom = new JSDOM('<div id="picker"></div>');
  const container = dom.window.document.getElementById("picker");
  const errors = [];
  const trace = [];
  const picker = createFilePicker(
    container,
    onFiles,
    (error) => errors.push(error),
    diagnostics
      ? (event, details) => trace.push({ event, ...details })
      : undefined
  );
  t.after(() => {
    picker.dispose();
    dom.window.close();
  });
  const select = (input, files, events = ["input", "change"]) => {
    Object.defineProperty(input, "files", { configurable: true, value: files });
    events.forEach((name) => input.dispatchEvent(new dom.window.Event(name)));
  };
  return { dom, container, picker, errors, select, trace };
}

test("a second selection is delivered while the first batch is still uploading", async (t) => {
  const batches = [];
  const complete = [];
  const { container, picker, select } = setup(t, (files) => {
    batches.push(files);
    return new Promise((resolve) => complete.push(resolve));
  });
  const firstFiles = [{ name: "first.jpg" }, { name: "second.jpg" }];
  picker.open();
  const firstInput = container.lastChild;
  select(firstInput, firstFiles);
  await tick();

  picker.open();
  const secondInput = container.lastChild;
  assert.notEqual(firstInput, secondInput);
  assert.equal(firstInput.isConnected, true);
  assert.equal(firstInput.files, firstFiles);
  const secondFiles = [{ name: "third.jpg" }];
  select(secondInput, secondFiles);
  await tick();
  assert.deepEqual(batches, [firstFiles, secondFiles]);
  assert.equal(container.children.length, 2);

  complete[0]();
  await tick();
  assert.equal(firstInput.isConnected, false);
  assert.equal(secondInput.isConnected, true);
  complete[1]();
  await tick();
  assert.equal(container.children.length, 0);
});

test("either native selection event works and input plus change never duplicates a batch", async (t) => {
  const batches = [];
  const { container, picker, select } = setup(t, (files) =>
    batches.push(files)
  );
  const files = [{ name: "same-photo.jpg" }];
  for (const events of [["input"], ["change"], ["input", "change"]]) {
    picker.open();
    select(container.lastChild, files, events);
    await tick();
  }
  assert.deepEqual(batches, [files, files, files]);
  assert.equal(container.children.length, 0);
});

test("cancelling another picker preserves the active upload's input", async (t) => {
  let complete;
  const { container, picker, select } = setup(
    t,
    () =>
      new Promise((resolve) => {
        complete = resolve;
      })
  );
  picker.open();
  const activeInput = container.lastChild;
  select(activeInput, [{ name: "uploading.jpg" }]);
  await tick();
  picker.open();
  select(container.lastChild, [], ["cancel"]);
  assert.equal(container.children.length, 1);
  assert.equal(activeInput.isConnected, true);
  complete();
  await tick();
  assert.equal(container.children.length, 0);
});

test("opening mounts and clicks synchronously and cleans up silent cancellations", (t) => {
  const { dom, container, picker } = setup(t, () =>
    assert.fail("no selection")
  );
  const clicked = [];
  dom.window.HTMLInputElement.prototype.click = function () {
    assert.equal(this.isConnected, true);
    clicked.push(this);
  };
  assert.equal(picker.open(), true);
  assert.equal(clicked.length, 1);
  const abandoned = clicked[0];
  assert.equal(picker.open(), true);
  assert.equal(clicked.length, 2);
  assert.equal(abandoned.isConnected, false);
  assert.equal(container.children.length, 1);
});

test("selection failures are reported and release the associated input", async (t) => {
  const failure = new Error("queue failed");
  const { container, picker, errors, select } = setup(t, () => {
    throw failure;
  });
  picker.open();
  select(container.lastChild, [{ name: "photo.jpg" }]);
  await tick();
  assert.deepEqual(errors, [failure]);
  assert.equal(container.children.length, 0);
});

test("disposing releases all inputs and stops further picker events", async (t) => {
  let calls = 0;
  const { container, picker, select } = setup(t, () => {
    calls++;
  });
  picker.open();
  const input = container.lastChild;
  picker.dispose();
  select(input, [{ name: "late.jpg" }]);
  await tick();
  assert.equal(calls, 0);
  assert.equal(container.children.length, 0);
  assert.equal(picker.open(), false);
});

test("leaving the session immediately after selection does not enqueue an upload", async (t) => {
  const { container, picker, select } = setup(t, () =>
    assert.fail("session disposed")
  );
  picker.open();
  select(container.lastChild, [{ name: "photo.jpg" }]);
  picker.dispose();
  await tick();
  assert.equal(container.children.length, 0);
});

test("diagnostics distinguish a populated input with no event from an accepted selection", async (t) => {
  const batches = [];
  const { container, picker, select, trace } = setup(
    t,
    (files) => batches.push(files),
    true
  );
  picker.open();
  const input = container.lastChild;
  select(input, [{ name: "private-photo.jpg", size: 123 }], []);
  picker.inspect();
  assert.equal(batches.length, 0);
  assert.deepEqual(trace.at(-1), {
    event: "picker-snapshot",
    picker: 1,
    connected: true,
    accepted: false,
    fileCount: 1,
  });
  select(input, input.files, ["change"]);
  await tick();
  assert.equal(batches.length, 1);
  assert.ok(trace.some((entry) => entry.event === "picker-deliver-to-queue"));
  assert.equal(trace.at(-1).reason, "batch-settled");
  assert.doesNotMatch(JSON.stringify(trace), /private-photo/);
});

test("diagnostics record an empty native cancel without attributing it to user intent", (t) => {
  const { container, picker, select, trace } = setup(
    t,
    () => assert.fail("no selection"),
    true
  );
  picker.open();
  select(container.lastChild, [], ["cancel"]);
  const event = trace.find((entry) => entry.type === "cancel");
  assert.equal(event.fileCount, 0);
  assert.equal(event.accepted, false);
  assert.equal(trace.at(-1).reason, "cancel");
});
