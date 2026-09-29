import assert from "node:assert/strict";
import test from "node:test";

import { createRuntimeProbeArgs } from "./smoke-mindx-runtime.mjs";

test("probes the runtime from inside its container", () => {
  const args = createRuntimeProbeArgs("mindx-runtime", "/status/health");

  assert.deepEqual(args.slice(0, 5), [
    "exec",
    "mindx-runtime",
    "node",
    "--input-type=module",
    "--eval",
  ]);
  assert.match(args[5], /http:\/\/127\.0\.0\.1:3000/);
  assert.equal(args[6], "/status/health");
});

test("rejects a runtime probe path without a leading slash", () => {
  assert.throws(
    () => createRuntimeProbeArgs("mindx-runtime", "status/health"),
    /must start with/,
  );
});
