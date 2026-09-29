import assert from "node:assert/strict";
import test from "node:test";

const moduleUrl = new URL("../issue-contract.mjs", import.meta.url);

test("Issue AC canonicalization is deterministic and checkbox-insensitive", async () => {
  const { canonicalizeIssueAcceptanceCriteria } = await import(moduleUrl.href);
  const unchecked = canonicalizeIssueAcceptanceCriteria(
    "# Feature\r\n\r\n## 验收标准\r\n\r\n- [ ] AC-1:  可观察结果  \r\n- [x] AC-2: 边界结果\r\n\r\n## 非目标\r\nnone\r\n",
  );
  const checked = canonicalizeIssueAcceptanceCriteria(
    "## 验收标准\n- [X] AC-1:  可观察结果\n- [ ] AC-2: 边界结果\n",
  );

  assert.equal(
    unchecked.canonicalJson,
    '[{"id":"AC-1","text":"可观察结果"},{"id":"AC-2","text":"边界结果"}]',
  );
  assert.equal(unchecked.digest, checked.digest);
  assert.match(unchecked.digest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(unchecked.mode, "structured");
});

test("Issue AC canonicalization rejects ambiguous or empty contracts", async () => {
  const { canonicalizeIssueAcceptanceCriteria } = await import(moduleUrl.href);
  for (const body of [
    "no acceptance section",
    "## 验收标准\n",
    "## 验收标准\n- [ ] AC-1: one\ncontinuation",
    "## 验收标准\n- [ ] AC-1: one\n- [ ] AC-1: duplicate",
    "## 验收标准\n- [ ] not-an-ac",
  ]) {
    assert.throws(
      () => canonicalizeIssueAcceptanceCriteria(body),
      /AC_CANONICAL_INVALID/,
    );
  }
});

test("legacyIssueBodyDigest is stable across whitespace-equivalent bodies", async () => {
  const { legacyIssueBodyDigest } = await import(moduleUrl.href);
  const a = legacyIssueBodyDigest(
    "  产品需求\r\n\r\n- 目标 A\r\n- 目标 B\r\n  ",
  );
  const b = legacyIssueBodyDigest("产品需求\n\n- 目标 A\n- 目标 B");
  assert.equal(a, b);
  assert.match(a, /^legacy:sha256:[0-9a-f]{64}$/);
});

test("computeAcContractDigest prefers structured, falls back to legacy", async () => {
  const { computeAcContractDigest } = await import(moduleUrl.href);
  const structured = computeAcContractDigest(
    "## 验收标准\n- [ ] AC-1: hello\n",
  );
  assert.equal(structured.mode, "structured");
  assert.match(structured.digest, /^sha256:[0-9a-f]{64}$/);

  const legacy = computeAcContractDigest(
    "# 存量 Issue\n\n验收标准写在这里，没有结构化 heading。",
  );
  assert.equal(legacy.mode, "legacy");
  assert.match(legacy.digest, /^legacy:sha256:[0-9a-f]{64}$/);
  assert.equal(typeof legacy.reason, "string");
});
