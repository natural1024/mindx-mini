import assert from "node:assert/strict";
import test from "node:test";

const moduleUrl = new URL("../check-commit-issue-ref.mjs", import.meta.url);

test("prototype and production branches bind every commit to their branch Issue", async () => {
  const { resolveBranchBoundIssueId, checkBranchIssueBinding } = await import(
    moduleUrl.href
  );

  assert.equal(resolveBranchBoundIssueId("prototype/418-memory-card"), 418);
  assert.equal(resolveBranchBoundIssueId("feature/418-memory-card"), 418);
  assert.equal(resolveBranchBoundIssueId("bugfix/418-memory-card"), 418);
  assert.equal(resolveBranchBoundIssueId("chore/update-ci"), null);

  assert.deepEqual(
    checkBranchIssueBinding({
      expectedIssueId: 418,
      ref: { kind: "issue", id: 418 },
    }),
    { allowed: true },
  );
  assert.equal(
    checkBranchIssueBinding({
      expectedIssueId: 418,
      ref: { kind: "issue", id: 419 },
    }).allowed,
    false,
  );
  assert.equal(
    checkBranchIssueBinding({
      expectedIssueId: 418,
      ref: { kind: "no-issue", id: null },
    }).allowed,
    false,
  );
});
