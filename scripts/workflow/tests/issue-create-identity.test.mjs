import assert from "node:assert/strict";
import test from "node:test";

import {
  assertCreatedIssueDetail,
  parseCreatedIssueId,
  resolveCreatedIssueIdentity,
} from "../issue-create-identity.mjs";

const expected = {
  title: "fix: prototype share identity",
  author: "leoricxu",
  body: "## 验收标准\n- [ ] AC-1: 分享覆盖同一 Page\n",
  labels: ["type:bug", "原型中"],
};
const startedAt = Date.parse("2026-07-24T10:00:00.000Z");
const endedAt = Date.parse("2026-07-24T10:00:10.000Z");

function candidate(overrides = {}) {
  return {
    iid: 1084,
    title: expected.title,
    author: { username: expected.author },
    body: expected.body,
    labels: expected.labels,
    created_at: "2026-07-24T10:00:05.000Z",
    ...overrides,
  };
}

test("parses an Issue IID after a noisy CNB version line", () => {
  assert.equal(
    parseCreatedIssueId('1.10.10\n{"status":201,"data":{"iid":1084}}\n'),
    1084,
  );
  assert.equal(
    parseCreatedIssueId('1.10.10\n{\n  "data": {\n    "iid": 1085\n  }\n}\n'),
    1085,
  );
});

test("a response IID is accepted only when the fetched detail matches every create field", () => {
  const detail = candidate();
  assert.deepEqual(
    resolveCreatedIssueIdentity({
      createOutput: '{"data":{"iid":1084}}',
      expected,
    }),
    { status: "DETAIL_REQUIRED", issueId: 1084 },
  );
  assert.equal(
    assertCreatedIssueDetail({ issueId: 1084, detail, expected }),
    detail,
  );
  assert.deepEqual(
    resolveCreatedIssueIdentity({
      createOutput: '{"data":{"iid":1084}}',
      responseIssueDetail: detail,
      expected,
    }),
    { status: "RESPONSE_ID", issueId: 1084 },
  );

  for (const [field, value] of [
    ["iid", 1085],
    ["title", "test"],
    ["body", "different body"],
    ["labels", ["原型中"]],
    ["author", { username: "someone-else" }],
  ]) {
    assert.throws(
      () =>
        resolveCreatedIssueIdentity({
          createOutput: '{"data":{"iid":1084}}',
          responseIssueDetail: candidate({ [field]: value }),
          expected,
        }),
      new RegExp(field === "iid" ? "iid" : field, "iu"),
      field,
    );
  }
});

test("bounded fingerprint recovery ignores same-title Issues with different identity", () => {
  const result = resolveCreatedIssueIdentity({
    createOutput: "1.10.10\n",
    expected,
    startedAt,
    endedAt,
    candidates: [
      candidate(),
      candidate({ iid: 1085, body: "different body" }),
      candidate({
        iid: 1086,
        created_at: "2026-07-23T10:00:05.000Z",
      }),
      candidate({ iid: 1087, author: { username: "someone-else" } }),
    ],
  });

  assert.deepEqual(result, { status: "FINGERPRINT_MATCH", issueId: 1084 });
});

test("multiple exact candidates fail closed and are never selected for auto-close", () => {
  const result = resolveCreatedIssueIdentity({
    createOutput: "",
    expected,
    startedAt,
    endedAt,
    candidates: [candidate(), candidate({ iid: 1085 })],
  });

  assert.deepEqual(result, {
    status: "AMBIGUOUS",
    issueIds: [1084, 1085],
  });
  assert.equal("issueId" in result, false);
});
