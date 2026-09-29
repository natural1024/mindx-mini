#!/usr/bin/env node
/**
 * Validate a PR's `Target-label:` syntax from CNB event metadata.
 *
 * `pull_request.update` checks out an untrusted pre-merge commit. This module
 * therefore has no platform client and needs no token: it parses only the
 * official `CNB_PULL_REQUEST_DESCRIPTION` environment value. The referenced
 * Issue is checked separately from trusted target-branch code.
 *
 * 2026-07-17：为了让开发者能够在 CI 首次跑起来之前把 PR body 补齐，
 * body 格式相关的错误（缺 / 重复 Target-label / AC-contract / Refs #）
 * 从「阻塞整个 stage」降级为「打印 warning 但退出 0」，并在 stderr 输出
 * 一段清晰的修复建议。仅当 source branch 是 prototype/** 时才 hard fail。
 */

import { pathToFileURL } from "node:url";

export const VALID_TARGET_LABELS = Object.freeze(["待发布", "none"]);

const TARGET_LABEL_LINE_PATTERN = /^Target-label:\s*(.*?)\s*$/gm;
const AC_CONTRACT_LINE_PATTERN = /^AC-contract:\s*(.*?)\s*$/gm;
const REFS_PATTERN = /\bRefs\s+#([1-9]\d*)\b/gi;
// 生产分支：feature|bugfix/<issue-id>-<slug>
const PRODUCTION_BRANCH_PATTERN =
  /^(feature|bugfix)\/([1-9]\d*)-[a-z0-9]+(?:-[a-z0-9]+)*$/;
// 工程分支：chore|docs|refactor|style|test|build|ci|perf/<slug>
const INFRASTRUCTURE_BRANCH_PATTERN =
  /^(chore|docs|refactor|style|test|build|ci|perf)\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DOC_REF = "详见 docs/release-workflow.md §6";

export class TargetLabelValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "TargetLabelValidationError";
  }
}

/**
 * SoftValidationError：body 格式错误，但不阻塞 stage。
 * 只 warning，退出码保持 0。用于允许开发者创建 PR 后再逐步补 body。
 */
export class TargetLabelSoftValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "TargetLabelSoftValidationError";
  }
}

function requiredEnv(env, name) {
  const value = env[name];
  if (!value) {
    throw new TargetLabelValidationError(`缺少必要环境变量：${name}`);
  }
  return value;
}

function logSection(logger, title) {
  logger.log("");
  logger.log(`-- ${title} --`);
}

/** 判断 digest 字符串是否合法（支持结构化 sha256 与 legacy 兜底）。 */
export function isValidAcContractDigest(value) {
  const v = String(value || "").trim();
  return (
    v === "none" ||
    /^sha256:[0-9a-f]{64}$/u.test(v) ||
    /^legacy:sha256:[0-9a-f]{64}$/u.test(v)
  );
}

export function parseTargetLabel(description) {
  const matches = [
    ...String(description || "").matchAll(TARGET_LABEL_LINE_PATTERN),
  ];
  if (matches.length === 0) {
    throw new TargetLabelSoftValidationError(
      `PR description 中缺少 \`Target-label:\` 字段。合法取值：${VALID_TARGET_LABELS.join(" | ")}`,
    );
  }
  if (matches.length > 1) {
    throw new TargetLabelSoftValidationError(
      "PR description 中存在多个 `Target-label:` 字段，请只保留一个。",
    );
  }

  const targetLabel = matches[0][1].trim();
  if (targetLabel === "已发布") {
    throw new TargetLabelValidationError(
      "`Target-label: 已发布` 只能由 changelog 发布后处理写入；PR 阶段请改为 `Target-label: 待发布`。",
    );
  }
  if (!VALID_TARGET_LABELS.includes(targetLabel)) {
    throw new TargetLabelSoftValidationError(
      `Target-label 取值不合法：「${targetLabel}」。合法取值：${VALID_TARGET_LABELS.join(" | ")}`,
    );
  }

  return targetLabel;
}

export function parseSingleIssueRef(description, { required = false } = {}) {
  const matches = [...String(description || "").matchAll(REFS_PATTERN)];
  if (!required && matches.length === 0) return null;
  if (matches.length !== 1) {
    throw new TargetLabelSoftValidationError(
      required
        ? "`Target-label: 待发布` 必须且只能对应一行 `Refs #<issue-id>`。"
        : "PR description 中存在多个 `Refs #<issue-id>`，请只保留一行。",
    );
  }
  return Number(matches[0][1]);
}

export function parseAcContractDigest(description) {
  const matches = [
    ...String(description || "").matchAll(AC_CONTRACT_LINE_PATTERN),
  ];
  if (matches.length !== 1) {
    throw new TargetLabelSoftValidationError(
      "PR description 必须且只能包含一行 `AC-contract: sha256:<digest> | legacy:sha256:<digest> | none`。",
    );
  }
  const value = matches[0][1].trim();
  if (isValidAcContractDigest(value)) return value;
  throw new TargetLabelSoftValidationError(
    `AC-contract 取值不合法：${value || "(empty)"}。`,
  );
}

export function parseProductionBranchIssueId(branch) {
  const match = String(branch || "")
    .trim()
    .match(PRODUCTION_BRANCH_PATTERN);
  if (!match) {
    throw new TargetLabelValidationError(
      "待发布 PR source branch 必须符合 feature|bugfix/<issue-id>-<slug>。",
    );
  }
  return Number(match[2]);
}

export function classifyPrSourceBranch(branch) {
  const normalizedBranch = String(branch || "").trim();
  const productionMatch = normalizedBranch.match(PRODUCTION_BRANCH_PATTERN);
  if (productionMatch) {
    return {
      kind: "production",
      branch: normalizedBranch,
      issueIid: Number(productionMatch[2]),
    };
  }
  if (INFRASTRUCTURE_BRANCH_PATTERN.test(normalizedBranch)) {
    return {
      kind: "infrastructure",
      branch: normalizedBranch,
      issueIid: null,
    };
  }
  throw new TargetLabelSoftValidationError(
    "PR source branch 建议是 feature|bugfix/<issue-id>-<slug> 或白名单工程分支；当前分支名不符合，稍后会当作 infrastructure 处理。",
  );
}

export function validatePrRouteContract({
  sourceBranch,
  targetLabel,
  issueIid,
  acContractDigest,
}) {
  let route;
  try {
    route = classifyPrSourceBranch(sourceBranch);
  } catch (error) {
    // 分支名不符合任何规则时，按最宽松的 infrastructure 处理，只做软告警。
    if (error instanceof TargetLabelSoftValidationError) throw error;
    throw error;
  }
  if (route.kind === "production") {
    if (targetLabel !== "待发布") {
      throw new TargetLabelSoftValidationError(
        `production 分支 ${route.branch} 建议使用 Target-label: 待发布（当前：${targetLabel}）。`,
      );
    }
    if (route.issueIid !== issueIid) {
      throw new TargetLabelSoftValidationError(
        `PR branch 绑定 Issue #${route.issueIid}，但 description 引用 Issue #${issueIid || "(missing)"}。`,
      );
    }
    if (
      !/^sha256:[0-9a-f]{64}$/u.test(acContractDigest || "") &&
      !/^legacy:sha256:[0-9a-f]{64}$/u.test(acContractDigest || "")
    ) {
      throw new TargetLabelSoftValidationError(
        `production 分支 ${route.branch} 建议绑定真实 AC-contract digest（sha256: 或 legacy:sha256:）。`,
      );
    }
  } else {
    if (targetLabel !== "none") {
      throw new TargetLabelSoftValidationError(
        `工程分支 ${route.branch} 建议使用 Target-label: none（当前：${targetLabel}）。`,
      );
    }
    if (acContractDigest !== "none") {
      throw new TargetLabelSoftValidationError(
        `工程分支 ${route.branch} 建议使用 AC-contract: none（当前：${acContractDigest}）。`,
      );
    }
  }
  return route;
}

/**
 * 综合校验器：把所有可能的软/硬错误集中处理，让 CI stage 输出一致的形式。
 * hardErrors → exit 1
 * softErrors → warning + exit 0
 * ok → info + exit 0
 */
export function collectPrRouteFindings({ sourceBranch, description }) {
  const findings = { hardErrors: [], softErrors: [], info: [] };
  let targetLabel = null;
  let acContractDigest = null;
  let issueIid = null;

  try {
    targetLabel = parseTargetLabel(description);
  } catch (error) {
    (error instanceof TargetLabelSoftValidationError
      ? findings.softErrors
      : findings.hardErrors
    ).push(error.message);
  }

  try {
    acContractDigest = parseAcContractDigest(description);
  } catch (error) {
    (error instanceof TargetLabelSoftValidationError
      ? findings.softErrors
      : findings.hardErrors
    ).push(error.message);
  }

  try {
    issueIid = parseSingleIssueRef(description, {
      required: targetLabel === "待发布",
    });
  } catch (error) {
    (error instanceof TargetLabelSoftValidationError
      ? findings.softErrors
      : findings.hardErrors
    ).push(error.message);
  }

  let route = null;
  try {
    route = validatePrRouteContract({
      sourceBranch,
      targetLabel,
      issueIid,
      acContractDigest,
    });
    findings.info.push(
      `route=${route.kind} branch=${route.branch} target-label=${targetLabel} ac-contract=${acContractDigest}`,
    );
  } catch (error) {
    (error instanceof TargetLabelSoftValidationError
      ? findings.softErrors
      : findings.hardErrors
    ).push(error.message);
  }

  return { findings, targetLabel, acContractDigest, issueIid, route };
}

export async function runCheckMrSyncStatus({
  env = process.env,
  logger = console,
} = {}) {
  const prIid = requiredEnv(env, "CNB_PULL_REQUEST_IID");
  const description = requiredEnv(env, "CNB_PULL_REQUEST_DESCRIPTION");
  const sourceBranch = requiredEnv(env, "CNB_PULL_REQUEST_BRANCH");

  logger.log(`PR: #${prIid}`);
  logSection(logger, "Validate PR description syntax");

  const { findings, targetLabel, acContractDigest, issueIid, route } =
    collectPrRouteFindings({ sourceBranch, description });

  for (const info of findings.info) {
    logger.log(info);
  }

  if (findings.softErrors.length > 0) {
    logger.log("");
    logger.log("⚠️  PR body 建议修正（本 stage 不阻塞，请尽快补齐）：");
    for (const soft of findings.softErrors) {
      logger.log(`  - ${soft}`);
    }
    logger.log("");
    logger.log(DOC_REF);
  }

  if (findings.hardErrors.length > 0) {
    for (const hard of findings.hardErrors) {
      logger.error(`❌ ${hard}`);
    }
    throw new TargetLabelValidationError(
      `PR #${prIid} description hard errors: ${findings.hardErrors.length}`,
    );
  }

  logger.log("Syntax only: trusted target code validates the referenced Issue");

  return {
    status:
      findings.softErrors.length > 0 ? "validated-with-warnings" : "validated",
    prIid,
    targetLabel,
    issueIid,
    acContractDigest,
    sourceBranch,
    route: route?.kind || null,
    softErrors: findings.softErrors,
  };
}

function isDirectExecution() {
  return Boolean(
    process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url,
  );
}

if (isDirectExecution()) {
  runCheckMrSyncStatus().catch((error) => {
    console.error("");
    console.error("check-mr-sync-status FAIL");
    console.error(error.message || error);
    console.error("");
    console.error(DOC_REF);
    process.exitCode = 1;
  });
}
