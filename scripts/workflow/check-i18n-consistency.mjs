#!/usr/bin/env node
/**
 * check-i18n-consistency.mjs
 *
 * CI 兜底门禁：调用 `pnpm i18n:check`（汇总 apps/mindx、packages/ui-components、
 * packages/import-kit 三个词条包的静态一致性校验），失败时扫描本次 PR 的 commit
 * message 找 `[skip-i18n]: <说明>` 豁免标记——命中则把失败降级为醒目告警放行
 * （不静默通过，reviewer 在流水线日志可见）；未命中则阻断（exit 1）。
 *
 * 背景：`.husky/pre-commit` 的 `check-i18n-literals.mjs` 只查 staged diff 中
 * 新增的裸中文字面量，抓不到词条文件本身的完整性/一致性问题（重复 key、空值、
 * 插值不一致、语言固化、跨包同名 key 冲突等）。这些问题只能靠 `pnpm i18n:check`
 * 全量扫描抓出，本脚本把它接到 CI 层做最后兜底。七项检查详见
 * `.codebuddy/skills/i18n-expert/SKILL.md`。
 *
 * 显式豁免出口：在 commit body 追加一行
 *     [skip-i18n]: <说明为什么本次可以暂缓修复>
 *   - CI：豁免不静默通过，打 ⚠️ 醒目告警让 reviewer 在流水线日志可见（exit 0）
 *
 * 使用：
 *   CI_MODE=1 BASE_REF=$DIFF_BASE_SHA HEAD_REF=$CNB_PULL_REQUEST_SHA \
 *     node scripts/workflow/check-i18n-consistency.mjs
 *
 * 退出码：
 *   - 0 = PASS（含豁免放行）
 *   - 1 = FAIL（i18n:check 未通过且无豁免）
 *   - 2 = 异常（参数缺失等）
 */

import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const DOC_REF = "📘 详细规范：.codebuddy/skills/i18n-expert/SKILL.md";

function log(...args) {
  console.error(...args);
}

/** commit body 中任意一行形如 `[skip-i18n]: <说明>` 即视为豁免声明。 */
export function hasSkipI18nWaiver(fullMsg) {
  return /^\s*\[skip-i18n\]\s*:\s*\S+/m.test(String(fullMsg || ""));
}

/**
 * 根据 i18n:check 结果与豁免标记决定最终结论。
 * 抽成纯函数便于单测，不依赖真实 git/pnpm 调用。
 */
export function decideOutcome({ passed, waived }) {
  if (passed) return { exitCode: 0, status: "pass" };
  if (waived) return { exitCode: 0, status: "waived" };
  return { exitCode: 1, status: "blocked" };
}

/** 跑 `pnpm i18n:check`，返回是否通过与原始输出（stdout+stderr）。 */
export function runI18nCheck({ exec = execSync } = {}) {
  try {
    const out = exec("pnpm i18n:check", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    });
    return { passed: true, output: out };
  } catch (error) {
    const output =
      `${error.stdout || ""}${error.stderr || ""}` ||
      String(error.message || error);
    return { passed: false, output };
  }
}

/** 拉取 baseRef...headRef 范围内所有 commit 的完整 message（用于扫描豁免标记）。 */
export function collectCommitMessages(
  baseRef,
  headRef,
  { exec = execSync } = {},
) {
  let shas;
  try {
    shas = exec(
      `git log ${baseRef}...${headRef} --no-merges --pretty=format:"%H"`,
      {
        encoding: "utf8",
      },
    )
      .split("\n")
      .filter(Boolean);
  } catch (error) {
    log(`⚠️ 无法读取 commit 列表（${error.message}），视为无豁免标记`);
    return [];
  }

  return shas.map((sha) => {
    try {
      return exec(`git log -1 --pretty=format:%B ${sha}`, { encoding: "utf8" });
    } catch {
      return "";
    }
  });
}

function printBlockedReport(output) {
  log("\n❌ pnpm i18n:check 未通过：\n");
  log(output);
  log("\n处理方式（二选一）：");
  log(
    "  [A] 修复上述词条问题：本地跑 `pnpm i18n:check` 定位，参考 i18n-expert skill",
  );
  log("  [B] 确属紧急场景 → 在 commit body 追加一行显式豁免：");
  log("        [skip-i18n]: <说明为什么本次可以暂缓修复>");
  log(
    "        注意：该标记会持续豁免本分支后续所有提交，请尽快修复并移除，不要长期依赖豁免。",
  );
  log("");
  log(DOC_REF);
}

function printWaivedReport(output) {
  log(
    "\n⚠️⚠️⚠️ pnpm i18n:check 未通过，但检测到 [skip-i18n] 豁免标记，降级为告警放行：\n",
  );
  log(output);
  log("\n请 reviewer 在 MR 中人工确认上述问题是否可接受。");
  log(DOC_REF);
}

export function getCiMode({ env = process.env } = {}) {
  const baseRef = env.BASE_REF;
  const headRef = env.HEAD_REF || "HEAD";
  if (!baseRef) {
    log("❌ CI 模式必须设置 BASE_REF 环境变量");
    process.exit(2);
  }

  const { passed, output } = runI18nCheck();
  const messages = passed ? [] : collectCommitMessages(baseRef, headRef);
  const waived = messages.some(hasSkipI18nWaiver);
  const { exitCode, status } = decideOutcome({ passed, waived });

  if (status === "pass") {
    log(
      "✅ pnpm i18n:check 通过（apps/mindx / ui-components / import-kit 三包一致）",
    );
  } else if (status === "waived") {
    printWaivedReport(output);
  } else {
    printBlockedReport(output);
  }

  process.exit(exitCode);
}

function main() {
  const ciMode = process.env.CI_MODE === "1";
  if (ciMode) return getCiMode();

  log(
    "❌ 用法：CI_MODE=1 BASE_REF=... HEAD_REF=... node check-i18n-consistency.mjs",
  );
  process.exit(2);
}

function isDirectExecution() {
  return Boolean(
    process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url,
  );
}

if (isDirectExecution()) {
  main();
}
