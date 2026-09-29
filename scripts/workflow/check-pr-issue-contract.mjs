#!/usr/bin/env node
/** Read-only Issue contract validation executed from trusted target code.
 *
 * 2026-07-17 修订：
 * - PR body 层的软错误（缺 Target-label / AC-contract / Refs 之类的格式偏差）
 *   由 check-mr-sync-status.mjs 的 collectPrRouteFindings 报告为 warning，
 *   本脚本只在 `production` route 拿不到 Issue ID / AC digest 时才升级为 hard fail。
 * - Issue 状态放宽为 `待研发` / `开发中` / `待发布` 之一；只有 closed / 未知
 *   状态 / `原型中` / `已发布` 才 hard fail。
 * - AC digest 支持 `legacy:sha256:...`：Issue body 不符合结构化 `## 验收标准`
 *   时用 body 原文 sha256 兜底，只要 body 没有变化即视为稳定。
 */

import { pathToFileURL } from "node:url";
import {
  collectPrRouteFindings,
  isValidAcContractDigest,
  TargetLabelValidationError,
} from "./check-mr-sync-status.mjs";
import {
  computeAcContractDigest,
  legacyIssueBodyDigest,
  readIssueBody,
} from "./issue-contract.mjs";
import {
  assertInfrastructureChangedPaths,
  resolvePullRequestChangedPaths,
} from "./infrastructure-route.mjs";
import { getIssueState } from "./issue-state.mjs";
import { createPlatformClient, platformUtils } from "./platform-client.mjs";

/** 生产 PR 允许绑定的 Issue 状态。 */
const ALLOWED_ISSUE_STATES_FOR_PRODUCTION = Object.freeze([
  "待研发",
  "开发中",
  "待发布",
]);
/** 明确拒绝的 Issue 状态（closed / 已发布 / 原型中）。 */
const REJECTED_ISSUE_STATES = Object.freeze(["原型中", "已发布"]);

function requiredEnv(env, name) {
  const value = env[name];
  if (!value) {
    throw new TargetLabelValidationError(`缺少必要环境变量：${name}`);
  }
  return value;
}

export async function runPrIssueContractCheck({
  env = process.env,
  client,
  logger = console,
  changedPaths,
  git,
} = {}) {
  const prIid = requiredEnv(env, "CNB_PULL_REQUEST_IID");
  const description = requiredEnv(env, "CNB_PULL_REQUEST_DESCRIPTION");
  const sourceBranch = requiredEnv(env, "CNB_PULL_REQUEST_BRANCH");

  const { findings, targetLabel, acContractDigest, issueIid, route } =
    collectPrRouteFindings({ sourceBranch, description });

  // 打印软告警
  if (findings.softErrors.length > 0) {
    logger.log("");
    logger.log("⚠️  PR body 建议修正（本 stage 只对硬错误阻塞）：");
    for (const soft of findings.softErrors) {
      logger.log(`  - ${soft}`);
    }
    logger.log("");
  }

  // 硬错误直接失败
  if (findings.hardErrors.length > 0) {
    for (const hard of findings.hardErrors) {
      logger.error(`❌ ${hard}`);
    }
    throw new TargetLabelValidationError(
      `PR #${prIid} description hard errors: ${findings.hardErrors.length}`,
    );
  }

  // 没有 route（分支名不匹配任何模式）→ 只输出软告警，不阻塞
  if (!route) {
    logger.log(`PR #${prIid}: no route inferred; skipping Issue check`);
    return {
      status: "validated-soft-only",
      prIid,
      targetLabel,
      issueIid,
      acContractDigest,
      sourceBranch,
      softErrors: findings.softErrors,
    };
  }

  // infrastructure 路径校验（累计 diff 必须落在白名单）
  if (route.kind === "infrastructure") {
    const trustedChangedPaths =
      changedPaths ??
      resolvePullRequestChangedPaths({
        env,
        sourceBranch,
        targetBranch: env.CNB_BRANCH || "main",
        git,
      });
    assertInfrastructureChangedPaths(trustedChangedPaths);
  }

  if (route.kind === "infrastructure" && issueIid === null) {
    logger.log(`PR #${prIid}: Target-label=none; no Issue state contract`);
    return {
      status: "validated-none",
      prIid,
      targetLabel,
      issueIid,
      acContractDigest,
      sourceBranch,
      softErrors: findings.softErrors,
    };
  }

  const resolvedClient =
    client || createPlatformClient({ token: env.CNB_TOKEN || "" });
  let issue;
  try {
    issue = await resolvedClient.getIssue(issueIid);
  } catch (error) {
    throw new TargetLabelValidationError(
      `无法读取 Issue #${issueIid}：${error.message}`,
    );
  }

  if (route.kind === "infrastructure") {
    logger.log(`PR #${prIid}: optional Issue #${issueIid} exists`);
    return {
      status: "validated-infrastructure-issue",
      prIid,
      targetLabel,
      issueIid,
      acContractDigest,
      sourceBranch,
      softErrors: findings.softErrors,
    };
  }

  if (issue?.state === "closed") {
    throw new TargetLabelValidationError(
      `Issue #${issueIid} 已关闭，不能作为待发布 PR 的契约。`,
    );
  }

  // Issue state：只有明确拒绝态才 hard fail
  const stateLabels = platformUtils.normalizeLabels(issue);
  const state = getIssueState(stateLabels);
  if (state && REJECTED_ISSUE_STATES.includes(state)) {
    throw new TargetLabelValidationError(
      `Issue #${issueIid} 当前状态为「${state}」，不能作为生产 PR 的契约。`,
    );
  }
  if (!state) {
    logger.log(
      `⚠️  Issue #${issueIid} 未设置状态 label；建议尽快置为「开发中」。`,
    );
  } else if (!ALLOWED_ISSUE_STATES_FOR_PRODUCTION.includes(state)) {
    // 未知状态 label：不 hard fail，只 warning
    logger.log(
      `⚠️  Issue #${issueIid} 状态「${state}」不在推荐范围（待研发/开发中/待发布），保持通过。`,
    );
  }

  // AC digest：先尝试结构化，失败则退回 legacy 兜底
  const contract = computeAcContractDigest(readIssueBody(issue));

  if (!isValidAcContractDigest(acContractDigest)) {
    throw new TargetLabelValidationError(
      `Issue #${issueIid}：PR 声明的 AC-contract 无效（${acContractDigest || "(missing)"}）。`,
    );
  }

  // 结构化 digest：必须完全匹配
  if (
    acContractDigest.startsWith("sha256:") &&
    contract.mode === "structured"
  ) {
    if (contract.digest !== acContractDigest) {
      throw new TargetLabelValidationError(
        `Issue #${issueIid} AC digest 已变化：PR=${acContractDigest}, current=${contract.digest}。`,
      );
    }
  } else if (acContractDigest.startsWith("legacy:sha256:")) {
    // legacy digest：Issue body 原文的 sha256 兜底
    const freshLegacy = legacyIssueBodyDigest(readIssueBody(issue));
    if (freshLegacy !== acContractDigest) {
      throw new TargetLabelValidationError(
        `Issue #${issueIid} legacy body digest 已变化：PR=${acContractDigest}, current=${freshLegacy}。`,
      );
    }
  } else if (
    acContractDigest.startsWith("sha256:") &&
    contract.mode === "legacy"
  ) {
    // PR 声明是结构化 digest，但 Issue body 已不符合结构化格式
    logger.log(
      `⚠️  Issue #${issueIid} 已不满足结构化 AC 契约（${contract.reason || "unknown"}），建议改用 legacy:sha256: 兜底 digest。`,
    );
    throw new TargetLabelValidationError(
      `Issue #${issueIid} 结构化 AC 已破坏，请把 PR body 的 AC-contract 改为 legacy:sha256:<digest>。`,
    );
  }

  logger.log(
    `PR #${prIid}: Issue #${issueIid} 状态=${state || "(无)"}，AC digest 匹配`,
  );
  return {
    status: "validated-issue",
    prIid,
    targetLabel,
    issueIid,
    issueState: state,
    acContractDigest,
    sourceBranch,
    softErrors: findings.softErrors,
  };
}

function isDirectExecution() {
  return Boolean(
    process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url,
  );
}

if (isDirectExecution()) {
  runPrIssueContractCheck().catch((error) => {
    console.error("");
    console.error("check-pr-issue-contract FAIL");
    console.error(error.message || error);
    process.exitCode = 1;
  });
}
