import assert from "node:assert/strict";
import test from "node:test";

const moduleUrl = new URL("../check-mr-sync-status.mjs", import.meta.url);

test("legacy AC-contract digest is accepted alongside structured sha256", async () => {
  const { isValidAcContractDigest } = await import(moduleUrl.href);
  assert.equal(isValidAcContractDigest("none"), true);
  assert.equal(isValidAcContractDigest(`sha256:${"a".repeat(64)}`), true);
  assert.equal(
    isValidAcContractDigest(`legacy:sha256:${"b".repeat(64)}`),
    true,
  );
  assert.equal(isValidAcContractDigest(""), false);
  assert.equal(isValidAcContractDigest("sha256:xyz"), false);
});

test("collectPrRouteFindings reports body errors as soft, does not throw", async () => {
  const { collectPrRouteFindings } = await import(moduleUrl.href);
  const description = "本 PR 修一个 bug"; // 缺 Target-label / AC-contract / Refs
  const { findings, route, targetLabel, acContractDigest } =
    collectPrRouteFindings({
      sourceBranch: "feature/864-fix-thing",
      description,
    });

  // 分类必须软失败，不是硬失败
  assert.equal(findings.hardErrors.length, 0);
  assert.ok(findings.softErrors.length >= 3);
  // 分支能被 classify，但 targetLabel / digest 都缺失 → 分支类型仍是 production
  // route 可能因为 targetLabel 缺失而无法通过 validatePrRouteContract，仍是软错误
  assert.equal(targetLabel, null);
  assert.equal(acContractDigest, null);
  // 我们的 collectPrRouteFindings 在缺 targetLabel 时不会调 validatePrRouteContract
  // 但会把这些都归到 softErrors
  assert.ok(route === null || route.kind === "production");
});

test("collectPrRouteFindings passes for a well-formed production PR body", async () => {
  const { collectPrRouteFindings } = await import(moduleUrl.href);
  const description = [
    "本 PR 实现 XX 功能。",
    "",
    "Refs #864",
    `AC-contract: sha256:${"c".repeat(64)}`,
    "Target-label: 待发布",
  ].join("\n");

  const { findings, route, targetLabel, acContractDigest, issueIid } =
    collectPrRouteFindings({
      sourceBranch: "feature/864-fix-thing",
      description,
    });

  assert.deepEqual(findings.hardErrors, []);
  assert.deepEqual(findings.softErrors, []);
  assert.equal(route.kind, "production");
  assert.equal(route.issueIid, 864);
  assert.equal(targetLabel, "待发布");
  assert.equal(acContractDigest, `sha256:${"c".repeat(64)}`);
  assert.equal(issueIid, 864);
});

test("collectPrRouteFindings accepts legacy digest for production PR", async () => {
  const { collectPrRouteFindings } = await import(moduleUrl.href);
  const description = [
    "旧 Issue，AC 未结构化。",
    "Refs #100",
    `AC-contract: legacy:sha256:${"d".repeat(64)}`,
    "Target-label: 待发布",
  ].join("\n");

  const { findings, route, acContractDigest } = collectPrRouteFindings({
    sourceBranch: "feature/100-legacy",
    description,
  });
  assert.deepEqual(findings.hardErrors, []);
  assert.deepEqual(findings.softErrors, []);
  assert.equal(route.kind, "production");
  assert.equal(acContractDigest, `legacy:sha256:${"d".repeat(64)}`);
});

test("collectPrRouteFindings passes for infrastructure PR with none/none", async () => {
  const { collectPrRouteFindings } = await import(moduleUrl.href);
  const description = [
    "纯工程化改动。",
    "AC-contract: none",
    "Target-label: none",
  ].join("\n");

  const { findings, route, targetLabel, acContractDigest } =
    collectPrRouteFindings({
      sourceBranch: "chore/pr-workflow-deprototype",
      description,
    });
  assert.deepEqual(findings.hardErrors, []);
  assert.deepEqual(findings.softErrors, []);
  assert.equal(route.kind, "infrastructure");
  assert.equal(targetLabel, "none");
  assert.equal(acContractDigest, "none");
});

test("已发布 Target-label is a hard error, not soft", async () => {
  const { collectPrRouteFindings } = await import(moduleUrl.href);
  const description = ["Target-label: 已发布", "AC-contract: none"].join("\n");
  const { findings } = collectPrRouteFindings({
    sourceBranch: "chore/x",
    description,
  });
  assert.ok(findings.hardErrors.length >= 1);
  assert.ok(
    findings.hardErrors.some((msg) => msg.includes("已发布")),
    "已发布 must trip a hard error",
  );
});
