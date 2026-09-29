#!/usr/bin/env node
/**
 * check-chore-no-issue-abuse.mjs
 *
 * 反「chore 伪装规避 issue」体检：当 commit 用 chore/docs/style/build/ci/refactor/perf
 * 之一 + [no-issue]，但本次改动 diff 落在【业务代码区】时，判定为疑似伪装并拦截。
 *
 * 背景漏洞：现有 commit-msg / commitlint / CI 只看 commit 的 type 字符串，不看 diff 内容。
 * 把明明是需求/bug 的改动写成 "chore: xxx [no-issue]" 就能合法绕过 issue 强制。本脚本
 * 通过「diff 路径体检」做启发式拦截——机器判断不了 chore 是否真 chore，但能判断 diff
 * 是否落在业务区。
 *
 * 详细规范：docs/release-workflow.md §2 / §11，docs/git-spec.md §1
 *
 * 调用场景：
 *   1. 本地 commit-msg hook（.husky/commit-msg）—— 业务区命中 → 阻塞（exit 1）
 *   2. CNB PR 流水线（.cnb.yml）—— 业务区命中 → 阻塞；带豁免 → 曝光告警放行
 *
 * 显式豁免出口：在 commit body 追加一行
 *     [skip-issue]: <说明为什么业务路径下的改动属于纯工程化>
 *   - 本地：豁免即放行（避免误伤、给紧急出口）
 *   - CI：豁免不静默通过，打 ⚠️ 醒目告警让 reviewer 在流水线日志可见（exit 0）
 *
 * 使用：
 *   - 本地：node scripts/workflow/check-chore-no-issue-abuse.mjs "$1"（commit msg file path）
 *   - CI：CI_MODE=1 BASE_REF=$DIFF_BASE_SHA HEAD_REF=$CNB_PULL_REQUEST_SHA \
 *         node scripts/workflow/check-chore-no-issue-abuse.mjs
 *
 * 退出码：
 *   - 0 = PASS（含豁免放行）
 *   - 1 = FAIL（疑似伪装且无豁免）
 *   - 2 = 异常
 */

import fs from "node:fs";
import { execSync } from "node:child_process";

// ─── 工具 ─────────────────────────────────────────────────────────────

function log(...args) {
  console.error(...args);
}

// 触发体检的 commit type（feat/fix 已被 check-commit-issue-ref 强制带 issue，无需在此重复）
const SUSPECT_TYPES = [
  "chore",
  "docs",
  "style",
  "build",
  "ci",
  "refactor",
  "perf",
];

// 业务代码区（任一命中即可疑）
const BUSINESS_PATH_REGEXES = [
  /^apps\/[^/]+\/src\/(pages|components|hooks|data)\//,
  /^packages\/core-data\/src\//,
  /^packages\/ui-components\/src\/components\//,
];

// 这些文件即便落在业务目录下，也视为非业务（测试 / 文档），不计入伪装判定
function isExemptFile(file) {
  return (
    /\.(test|spec)\.[jt]sx?$/.test(file) ||
    /\.(md|mdx)$/.test(file) ||
    /(^|\/)README/i.test(file)
  );
}

function isBusinessFile(file) {
  if (isExemptFile(file)) return false;
  return BUSINESS_PATH_REGEXES.some((re) => re.test(file));
}

// 解析 commit subject 的 type 前缀
function parseType(subject) {
  const m = subject.trim().match(/^([a-z]+)(\([^)]+\))?!?:\s*/);
  return m ? m[1] : null;
}

function hasNoIssueTag(subject) {
  return /\[no-issue\]\s*$/.test(subject.trim());
}

function hasSkipIssueWaiver(fullMsg) {
  // commit body 中任意一行形如 `[skip-issue]: <说明>`
  return /^\s*\[skip-issue\]\s*:\s*\S+/m.test(fullMsg);
}

// ─── 核心判定 ─────────────────────────────────────────────────────────

/**
 * @returns {{ suspect: boolean, businessFiles: string[] }}
 */
function inspect({ subject, changedFiles }) {
  const type = parseType(subject);
  // 只对 SUSPECT_TYPES + [no-issue] 的 commit 做体检
  if (!type || !SUSPECT_TYPES.includes(type) || !hasNoIssueTag(subject)) {
    return { suspect: false, businessFiles: [] };
  }
  const businessFiles = changedFiles.filter(isBusinessFile);
  return { suspect: businessFiles.length > 0, businessFiles };
}

function printSuspectReport(subject, businessFiles) {
  log(`🚨 检测到 chore/no-issue 伪装嫌疑：commit「${subject}」`);
  log(`   本次改动包含业务代码：`);
  for (const f of businessFiles) log(`     - ${f}`);
  log(``);
  log(
    `   业务代码改动应使用 feat/fix + 真实 #<issueid>，不能用 chore + [no-issue] 规避。`,
  );
  log(``);
  log(`   处理方式（二选一）：`);
  log(`     [A] 改 commit：git commit --amend，改成 feat/fix 并补 #<issueid>`);
  log(`         （无 issue 可以跟 AI 说"补一个 issue"，由 AI 自动建）`);
  log(`     [B] 确属工程化边缘场景 → 在 commit body 追加一行显式豁免：`);
  log(`           [skip-issue]: <说明为什么业务路径下的改动属于纯工程化>`);
  log(``);
  log(`   📘 详细规范：docs/release-workflow.md §2 / §11`);
}

// ─── 入口 ─────────────────────────────────────────────────────────────

function getCommitMsgMode(filePath) {
  const fullMsg = fs.readFileSync(filePath, "utf8");
  const subject = fullMsg.split("\n")[0].trim();

  if (!subject) {
    log(`⚠️ commit msg 为空，跳过 chore 伪装体检`);
    process.exit(0);
  }
  if (
    subject.startsWith("Merge ") ||
    subject.startsWith("Revert ") ||
    subject.startsWith("fixup!") ||
    subject.startsWith("squash!")
  ) {
    process.exit(0);
  }

  // 本地：拿暂存区改动文件
  let changedFiles = [];
  try {
    changedFiles = execSync("git diff --cached --name-only", {
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean);
  } catch (e) {
    log(`⚠️ 无法获取暂存区文件（${e.message}），跳过体检`);
    process.exit(0);
  }

  const { suspect, businessFiles } = inspect({ subject, changedFiles });
  if (!suspect) process.exit(0);

  if (hasSkipIssueWaiver(fullMsg)) {
    log(
      `⚠️ 检测到业务路径下的 chore + [no-issue]，但已声明 [skip-issue] 豁免，放行。`,
    );
    log(`   （该豁免会在 CI 流水线日志中曝光给 reviewer）`);
    process.exit(0);
  }

  printSuspectReport(subject, businessFiles);
  process.exit(1);
}

function getCiMode() {
  const baseRef = process.env.BASE_REF;
  const headRef = process.env.HEAD_REF || "HEAD";
  if (!baseRef) {
    log(`❌ CI 模式必须设置 BASE_REF 环境变量`);
    process.exit(2);
  }

  let commits;
  try {
    const out = execSync(
      `git log ${baseRef}...${headRef} --no-merges --pretty=format:"%H|%s"`,
      { encoding: "utf8" },
    );
    commits = out
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [sha, ...rest] = line.split("|");
        return { sha, subject: rest.join("|") };
      });
  } catch (e) {
    log(`❌ git log 失败：${e.message}`);
    process.exit(2);
  }

  if (commits.length === 0) {
    log(`✅ ${baseRef}...${headRef} 无 commit 需要体检`);
    process.exit(0);
  }

  let failed = 0;
  let waived = 0;
  for (const c of commits) {
    let changedFiles = [];
    let fullMsg = c.subject;
    try {
      changedFiles = execSync(
        `git diff-tree --no-commit-id --name-only -r ${c.sha}`,
        { encoding: "utf8" },
      )
        .split("\n")
        .filter(Boolean);
      fullMsg = execSync(`git log -1 --pretty=format:%B ${c.sha}`, {
        encoding: "utf8",
      });
    } catch {
      // 拿不到就只用 subject 体检
    }

    const { suspect, businessFiles } = inspect({
      subject: c.subject,
      changedFiles,
    });
    if (!suspect) continue;

    if (hasSkipIssueWaiver(fullMsg)) {
      waived++;
      log(`\n⚠️⚠️⚠️ ${c.sha.slice(0, 8)} 「${c.subject}」`);
      log(
        `   业务路径下的 chore + [no-issue]，已用 [skip-issue] 豁免。请 reviewer 人工确认：`,
      );
      for (const f of businessFiles) log(`     - ${f}`);
      continue;
    }

    log(`\n──── ${c.sha.slice(0, 8)} ────`);
    printSuspectReport(c.subject, businessFiles);
    failed++;
  }

  if (failed > 0) {
    log(`\n❌ 共 ${failed} 个 commit 疑似 chore 伪装规避 issue，CI 阻断`);
    process.exit(1);
  }
  if (waived > 0) {
    log(
      `\n⚠️ 共 ${waived} 个 commit 含 [skip-issue] 豁免，请 reviewer 在 MR 中人工确认其工程化性质。`,
    );
  }
  log(`\n✅ 无 chore 伪装嫌疑`);
  process.exit(0);
}

function main() {
  const argv = process.argv.slice(2);
  const ciMode = process.env.CI_MODE === "1";

  if (ciMode) return getCiMode();
  if (argv[0] && fs.existsSync(argv[0])) return getCommitMsgMode(argv[0]);

  log(`❌ 用法：node check-chore-no-issue-abuse.mjs <commit-msg-file>`);
  log(`   或：CI_MODE=1 BASE_REF=... HEAD_REF=... 调用`);
  process.exit(2);
}

main();
