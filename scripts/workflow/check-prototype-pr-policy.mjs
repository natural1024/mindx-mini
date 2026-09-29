#!/usr/bin/env node
/**
 * Reject every PR whose source branch belongs to the throwaway prototype flow.
 * Prototype branches may be pushed for preview, but they must never be merged.
 */

import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

export const PROTOTYPE_BRANCH_PREFIX = "prototype/";

export class PrototypePrPolicyError extends Error {
  constructor(message) {
    super(message);
    this.name = "PrototypePrPolicyError";
  }
}

function normalizeBranch(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function isPrototypeBranch(branch) {
  return normalizeBranch(branch).startsWith(PROTOTYPE_BRANCH_PREFIX);
}

export function evaluatePrototypePrPolicy({
  sourceBranch = "",
  targetBranch = "",
  prototypeLineageDetected = false,
} = {}) {
  const normalizedSource = normalizeBranch(sourceBranch);
  const normalizedTarget = normalizeBranch(targetBranch);

  if (isPrototypeBranch(normalizedSource) || prototypeLineageDetected) {
    return {
      allowed: false,
      sourceBranch: normalizedSource,
      targetBranch: normalizedTarget,
      reason:
        prototypeLineageDetected && !isPrototypeBranch(normalizedSource)
          ? "prototype lineage remains preview-only even after the branch is renamed"
          : "prototype branches are preview-only and must never create or update a PR",
    };
  }

  if (normalizedTarget !== "main") {
    return {
      allowed: false,
      sourceBranch: normalizedSource,
      targetBranch: normalizedTarget,
      reason: "repository PR target must be the protected main branch",
    };
  }

  return {
    allowed: true,
    sourceBranch: normalizedSource,
    targetBranch: normalizedTarget,
    reason: "production PR allowed",
  };
}

// CNB OnlyPreview（`.cnb/prototype-only-preview.yml`）已彻底下线；lineage 判定
// 只依赖仍然唯一属于 prototype 分支的三种 marker。
const PROTOTYPE_HISTORY_MARKERS = Object.freeze([
  "prototype.config.json",
  "apps/mindx/rspack.prototype.config.mjs",
  "apps/mindx/src/prototype/",
]);

function runGit(args) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.error || result.status !== 0) {
    throw new PrototypePrPolicyError(
      `prototype lineage scan failed: git ${args.join(" ")}\n${result.stderr || result.error?.message || "unknown error"}`,
    );
  }
  return (result.stdout || "").trim();
}

function containsPrototypeMarker(paths) {
  return String(paths || "")
    .split(/\r?\n/u)
    .some((filePath) =>
      PROTOTYPE_HISTORY_MARKERS.some(
        (marker) =>
          filePath === marker ||
          (marker.endsWith("/") && filePath.startsWith(marker)),
      ),
    );
}

/**
 * Only the `<mergeBase>..<head>` range matters: if the PR itself does not
 * touch any prototype marker file, historical prototype-only-preview files
 * that were merged into main once (or that live outside the diff) must not
 * trip the lineage check. This keeps the guard cheap for production PRs and
 * limits false positives once prototype scaffolding has been merged upstream.
 */
export function detectPrototypeLineage({ headRef, targetRef, git = runGit }) {
  const base = git(["merge-base", targetRef, headRef]);
  if (!/^[0-9a-f]{40}$/u.test(base)) {
    throw new PrototypePrPolicyError(
      `prototype lineage scan produced invalid merge base: ${base}`,
    );
  }
  const range = `${base}..${headRef}`;
  const historyPaths = git(["log", "--format=", "--name-only", range]);
  return containsPrototypeMarker(historyPaths);
}

export function runPrototypePrPolicy({
  env = process.env,
  logger = console,
  git = runGit,
} = {}) {
  const sourceBranch = normalizeBranch(
    env.CNB_PULL_REQUEST_BRANCH ||
      env.CI_MERGE_REQUEST_SOURCE_BRANCH_NAME ||
      "",
  );
  const targetBranch = normalizeBranch(
    env.CNB_BRANCH || env.CI_MERGE_REQUEST_TARGET_BRANCH_NAME || "",
  );

  if (!sourceBranch) {
    throw new PrototypePrPolicyError(
      "缺少 PR 源分支环境变量 CNB_PULL_REQUEST_BRANCH，无法执行 prototype PR 防线",
    );
  }

  if (!targetBranch) {
    throw new PrototypePrPolicyError(
      "缺少 PR 目标分支环境变量 CNB_BRANCH，无法执行 prototype PR 防线",
    );
  }

  let prototypeLineageDetected = false;
  // 快速路径：prototype/ 前缀直接拒，不用再花代价扫 lineage。
  if (!isPrototypeBranch(sourceBranch)) {
    git(["fetch", "origin", sourceBranch, "--depth=1000"]);
    const fetchedHead = git(["rev-parse", "FETCH_HEAD"]);
    git(["fetch", "origin", targetBranch, "--depth=1000"]);
    const fetchedTarget = git(["rev-parse", "FETCH_HEAD"]);
    const headRef = env.CNB_PULL_REQUEST_SHA || fetchedHead;
    const targetRef = env.CNB_PULL_REQUEST_TARGET_SHA || fetchedTarget;
    prototypeLineageDetected = detectPrototypeLineage({
      headRef,
      targetRef,
      git,
    });
  }

  const decision = evaluatePrototypePrPolicy({
    sourceBranch,
    targetBranch,
    prototypeLineageDetected,
  });
  if (!decision.allowed) {
    throw new PrototypePrPolicyError(
      `PR policy rejected ${sourceBranch} -> ${targetBranch || "(unknown)"}: ${decision.reason}`,
    );
  }

  logger.log(
    `Prototype PR policy passed: ${sourceBranch} -> ${targetBranch || "(unknown)"}`,
  );
  return decision;
}

function isDirectExecution() {
  return Boolean(
    process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url,
  );
}

if (isDirectExecution()) {
  try {
    runPrototypePrPolicy();
  } catch (error) {
    console.error("");
    console.error("check-prototype-pr-policy FAIL");
    console.error(error.message || error);
    process.exitCode = 1;
  }
}
