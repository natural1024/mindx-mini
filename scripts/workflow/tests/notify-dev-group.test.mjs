import assert from "node:assert/strict";
import test from "node:test";

import { buildMessage } from "../notify-dev-group.mjs";

function prEnvironment(overrides = {}) {
  return {
    CNB_EVENT: "pull_request.target",
    CNB_PULL_REQUEST_ACTION: "opened",
    CNB_PULL_REQUEST_IID: "1084",
    CNB_PULL_REQUEST_TITLE:
      "fix: make prototype sharing commit-free [no-issue]",
    CNB_PULL_REQUEST_PROPOSER: "leoricxu",
    CNB_PULL_REQUEST_BRANCH: "chore/prototype-workflow-optimizations",
    CNB_BRANCH: "main",
    CNB_REPO_NAME: "mindx",
    CNB_EVENT_URL: "https://cnb.woa.com/x-team/mindx/-/pulls/1084",
    ...overrides,
  };
}

const silentLogger = {
  log() {},
  warn() {},
};

test("opened PR notification uses the event's genuine title verbatim", () => {
  const title = "fix: make prototype sharing commit-free [no-issue]";
  const message = buildMessage(
    prEnvironment({ CNB_PULL_REQUEST_TITLE: title }),
    silentLogger,
  );

  assert.equal(message.includes(`**标题**：${title}`), true);
  assert.doesNotMatch(message, /标题.*test/iu);
});

test("synchronize events remain silent", () => {
  assert.equal(
    buildMessage(
      prEnvironment({ CNB_PULL_REQUEST_ACTION: "synchronize" }),
      silentLogger,
    ),
    null,
  );
});

test("opened events with a placeholder title fail closed", () => {
  for (const title of ["", "test", "WIP #1084", "临时"]) {
    assert.equal(
      buildMessage(
        prEnvironment({ CNB_PULL_REQUEST_TITLE: title }),
        silentLogger,
      ),
      null,
      title,
    );
  }
});
