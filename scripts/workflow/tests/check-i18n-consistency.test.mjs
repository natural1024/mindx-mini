import assert from "node:assert/strict";
import test from "node:test";

const moduleUrl = new URL("../check-i18n-consistency.mjs", import.meta.url);

test("hasSkipI18nWaiver detects [skip-i18n]: <说明> in commit body", async () => {
  const { hasSkipI18nWaiver } = await import(moduleUrl.href);

  assert.equal(
    hasSkipI18nWaiver(
      "chore: xxx [no-issue]\n\n[skip-i18n]: 紧急 hotfix，词条问题后补",
    ),
    true,
  );
  assert.equal(hasSkipI18nWaiver("feat: add page #123"), false);
  assert.equal(hasSkipI18nWaiver(""), false);
  assert.equal(hasSkipI18nWaiver(null), false);
  // 标记后必须跟非空说明，纯 `[skip-i18n]:` 不算合法豁免
  assert.equal(hasSkipI18nWaiver("[skip-i18n]:"), false);
});

test("hasSkipI18nWaiver matches regardless of leading whitespace/indentation", async () => {
  const { hasSkipI18nWaiver } = await import(moduleUrl.href);
  assert.equal(hasSkipI18nWaiver("  [skip-i18n]: 说明文字"), true);
});

test("decideOutcome: passed check always exits 0 with status pass", async () => {
  const { decideOutcome } = await import(moduleUrl.href);
  assert.deepEqual(decideOutcome({ passed: true, waived: false }), {
    exitCode: 0,
    status: "pass",
  });
  // passed=true 时 waived 不影响结果
  assert.deepEqual(decideOutcome({ passed: true, waived: true }), {
    exitCode: 0,
    status: "pass",
  });
});

test("decideOutcome: failed check with waiver downgrades to warning (exit 0)", async () => {
  const { decideOutcome } = await import(moduleUrl.href);
  assert.deepEqual(decideOutcome({ passed: false, waived: true }), {
    exitCode: 0,
    status: "waived",
  });
});

test("decideOutcome: failed check without waiver blocks (exit 1)", async () => {
  const { decideOutcome } = await import(moduleUrl.href);
  assert.deepEqual(decideOutcome({ passed: false, waived: false }), {
    exitCode: 1,
    status: "blocked",
  });
});

test("runI18nCheck: passed=true when exec succeeds", async () => {
  const { runI18nCheck } = await import(moduleUrl.href);
  const fakeExec = () => "all good";
  const result = runI18nCheck({ exec: fakeExec });
  assert.equal(result.passed, true);
  assert.equal(result.output, "all good");
});

test("runI18nCheck: passed=false and captures stdout/stderr when exec throws", async () => {
  const { runI18nCheck } = await import(moduleUrl.href);
  const fakeExec = () => {
    const error = new Error("command failed");
    error.stdout = "some i18n violations\n";
    error.stderr = "";
    throw error;
  };
  const result = runI18nCheck({ exec: fakeExec });
  assert.equal(result.passed, false);
  assert.match(result.output, /some i18n violations/);
});

test("collectCommitMessages: returns full message per commit sha", async () => {
  const { collectCommitMessages } = await import(moduleUrl.href);
  const calls = [];
  const fakeExec = (cmd) => {
    calls.push(cmd);
    if (cmd.includes("git log") && cmd.includes('--pretty=format:"%H"')) {
      return "sha1\nsha2\n";
    }
    if (cmd.includes("git log -1")) {
      return cmd.includes("sha1") ? "feat: a #1" : "chore: b [skip-i18n]: ok";
    }
    return "";
  };
  const messages = collectCommitMessages("base", "head", { exec: fakeExec });
  assert.deepEqual(messages, ["feat: a #1", "chore: b [skip-i18n]: ok"]);
});

test("collectCommitMessages: returns empty array when git log fails", async () => {
  const { collectCommitMessages } = await import(moduleUrl.href);
  const fakeExec = () => {
    throw new Error("git not available");
  };
  const messages = collectCommitMessages("base", "head", { exec: fakeExec });
  assert.deepEqual(messages, []);
});
