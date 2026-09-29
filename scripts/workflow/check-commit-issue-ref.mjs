#!/usr/bin/env node
/**
 * check-commit-issue-ref.mjs
 *
 * 校验 commit message subject 末尾必带 #<issueid> 或 [no-issue]，
 * 并根据角色 × commit type 矩阵做精细化校验。
 *
 * 详细规范：docs/release-workflow.md §1, §2
 *
 * 调用场景：
 *   1. 本地 commit-msg hook（.husky/commit-msg）—— 弱校验（仅正则 + 角色矩阵）
 *   2. CNB PR 流水线（.cnb.yml）—— 强校验（含 CNB issue 真实性）
 *
 * 使用：
 *   - 本地：node scripts/workflow/check-commit-issue-ref.mjs "$1"（commit msg file path）
 *   - CI：BASE_REF=$DIFF_BASE_SHA HEAD_REF=$CNB_PULL_REQUEST_SHA \
 *         CI_MODE=1 CNB_TOKEN=$CNB_TOKEN \
 *         node scripts/workflow/check-commit-issue-ref.mjs
 *
 * 入参：
 *   - argv[2]（可选）：commit msg file path（commit-msg hook 模式）
 *   - 环境变量 CI_MODE=1：开启 CI 模式（强校验）
 *   - 环境变量 BASE_REF / HEAD_REF：CI 模式下的 diff 范围
 *   - 环境变量 CNB_TOKEN：CI 模式下用于只读 CNB API 鉴权
 *     （MINDX_CI_TOKEN 仅作为旧可信流水线兼容回退）
 *   - 环境变量 GIT_USER_NAME：覆盖 git config user.name 用于测试
 *   - 环境变量 CNB_API_ENDPOINT / CNB_REPO_SLUG：CI 模式下用于定位 CNB 仓库
 *
 * 退出码：
 *   - 0 = PASS
 *   - 1 = FAIL（commit msg 不合规）
 *   - 2 = 异常（无法读取 commit msg / API 不可达且 CI 模式）
 *
 * 角色 × commit type 矩阵：
 *   产品/设计师 + 任意 type   → 必须 #<issueid>
 *   开发者 + feat/fix         → 必须 #<issueid>
 *   开发者 + 其它类型         → 可 [no-issue]
 *
 * 本地降级策略（commit-msg hook 模式）：
 *   - CNB API 不可达 → stderr 警告 + 跳过 issue 真实性校验（保留正则 + 角色矩阵）
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createPlatformClient } from "./platform-client.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

// ─── 工具 ─────────────────────────────────────────────────────────────

function log(...args) {
  console.error(...args);
}

function readDeveloperAllowlist() {
  const repoRoot = path.resolve(SCRIPT_DIR, "..", "..");
  const filePath = path.join(repoRoot, ".vibe/developer-allowlist.json");
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const json = JSON.parse(raw);
    return (json.developers || []).map((d) => d.username);
  } catch (e) {
    log(`⚠️ 读取 .vibe/developer-allowlist.json 失败：${e.message}`);
    return [];
  }
}

function getCurrentUserName() {
  if (process.env.GIT_USER_NAME) return process.env.GIT_USER_NAME;
  try {
    return execSync("git config user.name", { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function determineRole(username) {
  const developers = readDeveloperAllowlist();
  return developers.includes(username) ? "developer" : "designer";
}

// ─── 正则与规则 ─────────────────────────────────────────────────────────

const ISSUE_REF_REGEX = /(#[1-9]\d*|\[no-issue\])$/;
const ISSUE_ID_REGEX = /#([1-9]\d*)$/;

const ALL_TYPES = [
  "feat",
  "fix",
  "chore",
  "docs",
  "style",
  "refactor",
  "perf",
  "test",
  "build",
  "ci",
  "revert",
];

// 这些 type 在开发者角色下允许 [no-issue]
const NO_ISSUE_ALLOWED_TYPES_FOR_DEVELOPER = [
  "chore",
  "docs",
  "refactor",
  "style",
  "test",
  "build",
  "ci",
  "perf",
  "revert",
];

// 解析 commit subject
function parseSubject(subject) {
  // 跳过 merge commit / revert commit auto-generated（用 git log 时检测；commit-msg hook 不需要）
  const trimmed = subject.trim();
  const typeMatch = trimmed.match(/^([a-z]+)(\([^)]+\))?!?:\s*(.+)$/);
  if (!typeMatch) {
    return { type: null, rest: trimmed };
  }
  return {
    type: typeMatch[1],
    rest: typeMatch[3].trim(),
  };
}

function parseIssueRef(subject) {
  const trimmed = subject.trim();
  if (trimmed.endsWith("[no-issue]")) return { kind: "no-issue", id: null };
  const m = trimmed.match(ISSUE_ID_REGEX);
  if (m) return { kind: "issue", id: Number(m[1]) };
  return { kind: "none", id: null };
}

export function resolveBranchBoundIssueId(branch) {
  const match = String(branch || "").match(
    /^(?:prototype|feature|bugfix)\/([1-9]\d*)-[a-z0-9]+(?:-[a-z0-9]+)*$/,
  );
  return match ? Number(match[1]) : null;
}

export function checkBranchIssueBinding({
  expectedIssueId,
  ref,
  isForeignCommit,
}) {
  if (expectedIssueId === null || expectedIssueId === undefined) {
    return { allowed: true };
  }
  // 非分支直系 commit（如 merge main 引入的 commit）豁免 issue 绑定校验
  if (isForeignCommit) {
    return { allowed: true };
  }
  if (ref?.kind === "issue" && ref.id === expectedIssueId) {
    return { allowed: true };
  }
  return {
    allowed: false,
    reason: `当前分支绑定 Issue #${expectedIssueId}，每个 commit 都必须以 #${expectedIssueId} 结尾，禁止其它 Issue 或 [no-issue]。`,
  };
}

// ─── CNB API ───────────────────────────────────────────────────────────

async function checkIssueExists(issueId, { ciMode, token }) {
  try {
    const client = createPlatformClient({
      token,
    });
    await client.getIssue(issueId);
    return { exists: true };
  } catch (e) {
    const status = e?.details?.status;
    if (status === 404) return { exists: false };
    if (!ciMode) {
      return { exists: null, error: e.message };
    }
    return { exists: null, error: e.message };
  }
}

// ─── 核心校验 ───────────────────────────────────────────────────────────

const ROLE_CHECK_RESULT = {
  PASS: "PASS",
  FAIL: "FAIL",
};

function checkRoleTypeMatrix({ role, type, ref }) {
  // 产品/设计师 + 任意 type：必须有 #<id>，[no-issue] 不允许
  if (role === "designer") {
    if (ref.kind === "no-issue") {
      return {
        status: ROLE_CHECK_RESULT.FAIL,
        reason:
          "产品/设计师角色禁止使用 [no-issue]。请创建/绑定 CNB issue，并在 commit subject 末尾加 #<issueid>。",
      };
    }
    if (ref.kind === "none") {
      return {
        status: ROLE_CHECK_RESULT.FAIL,
        reason:
          "产品/设计师角色 commit 必须以 #<issueid> 结尾。如不知道 issueid，请先创建 issue。",
      };
    }
    return { status: ROLE_CHECK_RESULT.PASS };
  }

  // 开发者：feat/fix 必须有 issue
  if (role === "developer") {
    if (ref.kind === "none") {
      return {
        status: ROLE_CHECK_RESULT.FAIL,
        reason: "commit subject 末尾必须以 #<issueid> 或 [no-issue] 结尾。",
      };
    }
    if (ref.kind === "no-issue") {
      if (type && !NO_ISSUE_ALLOWED_TYPES_FOR_DEVELOPER.includes(type)) {
        return {
          status: ROLE_CHECK_RESULT.FAIL,
          reason: `开发者使用 [no-issue] 时，commit type 必须是 ${NO_ISSUE_ALLOWED_TYPES_FOR_DEVELOPER.join(" / ")} 之一。当前 type=${type}，请改为 #<issueid> 或换用合规 type。`,
        };
      }
      return { status: ROLE_CHECK_RESULT.PASS };
    }
    return { status: ROLE_CHECK_RESULT.PASS };
  }

  return { status: ROLE_CHECK_RESULT.PASS };
}

// ─── 入口 ───────────────────────────────────────────────────────────────

async function runOnSingleSubject(
  subject,
  { role, ciMode, token, expectedIssueId = null, isForeignCommit = false },
) {
  const parsed = parseSubject(subject);
  const ref = parseIssueRef(subject);

  log(`📝 检查 commit subject：「${subject}」`);
  log(
    `   角色：${role} | type：${parsed.type || "(unknown)"} | issue ref：${ref.kind}${ref.id ? ` #${ref.id}` : ""}`,
  );

  // 1. 角色 × type 矩阵
  const matrixResult = checkRoleTypeMatrix({ role, type: parsed.type, ref });
  if (matrixResult.status === ROLE_CHECK_RESULT.FAIL) {
    log(`❌ ${matrixResult.reason}`);
    log(`📘 详细规范：docs/release-workflow.md §1, §2`);
    return false;
  }

  const branchBinding = checkBranchIssueBinding({
    expectedIssueId,
    ref,
    isForeignCommit,
  });
  if (!branchBinding.allowed) {
    log(`❌ ${branchBinding.reason}`);
    return false;
  }

  // 2. 如有 #<id>，校验真实性
  if (ref.kind === "issue") {
    if (!ciMode && !token) {
      log(`⚠️ 本地模式且无 CNB API token，跳过 issue 真实性校验（#${ref.id}）`);
      log(`   CI 流水线会做强校验，请确保 #${ref.id} 真实存在`);
      return true;
    }

    const result = await checkIssueExists(ref.id, { ciMode, token });
    if (result.exists === true) {
      log(`✅ issue #${ref.id} 真实存在`);
      return true;
    }
    if (result.exists === false) {
      log(
        `❌ issue #${ref.id} 在 CNB 仓库 ${process.env.CNB_REPO_SLUG || "(unknown)"} 中不存在`,
      );
      log(`   请检查是否写错 issueid，或先去 CNB 创建 issue`);
      return false;
    }
    // exists === null：API 异常
    if (ciMode) {
      log(`❌ CI 模式下 CNB API 调用失败：${result.error}`);
      log(`   请检查 CNB_TOKEN / CNB_API_ENDPOINT / CNB_REPO_SLUG 是否有效`);
      return false;
    } else {
      log(`⚠️ 本地 CNB API 不可达（${result.error}），降级跳过真实性校验`);
      return true;
    }
  }

  return true;
}

async function main() {
  const argv = process.argv.slice(2);
  const ciMode = process.env.CI_MODE === "1";
  // PR update pipelines use the ephemeral built-in token. CNB grants
  // untrusted PR events Issue read-only access, which is sufficient here and
  // avoids exposing the team's persistent write-capable credential.
  const token = process.env.CNB_TOKEN || process.env.MINDX_CI_TOKEN || "";
  const currentBranch =
    process.env.CNB_PULL_REQUEST_BRANCH ||
    (() => {
      try {
        return execSync("git branch --show-current", {
          encoding: "utf8",
        }).trim();
      } catch {
        return "";
      }
    })();
  const expectedIssueId = resolveBranchBoundIssueId(currentBranch);

  // 模式 1：commit-msg hook（传入 commit msg file path）
  if (argv[0] && fs.existsSync(argv[0])) {
    const msgRaw = fs.readFileSync(argv[0], "utf8");
    // 取第一行作为 subject（commit msg 首行）
    const subject = msgRaw.split("\n")[0].trim();
    if (!subject) {
      log(`⚠️ commit msg 为空，跳过校验`);
      process.exit(0);
    }

    // 跳过 merge / fixup / squash 等 git 自动生成的 commit
    if (
      subject.startsWith("Merge ") ||
      subject.startsWith("Revert ") ||
      subject.startsWith("fixup!") ||
      subject.startsWith("squash!")
    ) {
      log(`✅ 跳过自动生成 commit：${subject}`);
      process.exit(0);
    }

    const username = getCurrentUserName();
    const role = determineRole(username);
    log(`🔍 commit-msg hook · user=${username} · role=${role}`);

    const ok = await runOnSingleSubject(subject, {
      role,
      ciMode: false,
      token,
      expectedIssueId,
    });
    process.exit(ok ? 0 : 1);
  }

  // 模式 2：CI（无 file 参数，扫描 BASE_REF..HEAD_REF 的所有 commit）
  if (ciMode) {
    const baseRef = process.env.BASE_REF;
    const headRef = process.env.HEAD_REF || "HEAD";
    if (!baseRef) {
      log(`❌ CI 模式必须设置 BASE_REF 环境变量`);
      process.exit(2);
    }
    if (!token) {
      log(`❌ CI 模式必须提供 CNB_TOKEN（或兼容的 MINDX_CI_TOKEN）`);
      process.exit(2);
    }

    let commits;
    try {
      // 三点语法 base...head：取 head 独有的 commits
      const out = execSync(
        `git log ${baseRef}...${headRef} --no-merges --pretty=format:"%H|%an|%s"`,
        { encoding: "utf8" },
      );
      commits = out
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [sha, author, ...rest] = line.split("|");
          return { sha, author, subject: rest.join("|") };
        });
    } catch (e) {
      log(`❌ git log 失败：${e.message}`);
      process.exit(2);
    }

    if (commits.length === 0) {
      log(`✅ ${baseRef}...${headRef} 无 commit 需要校验`);
      process.exit(0);
    }

    // 获取分支直系祖先链（first-parent），用于豁免 merge main 引入的非直系 commit
    let branchAncestors = new Set();
    try {
      const firstParentCommits = execSync(
        `git log ${baseRef}..${headRef} --first-parent --pretty=format:"%H"`,
        { encoding: "utf8" },
      );
      branchAncestors = new Set(
        firstParentCommits
          .split("\n")
          .filter(Boolean)
          .map((h) => h.trim()),
      );
    } catch {
      // 降级：无法获取 first-parent 链时不豁免
    }

    log(`🔍 CI 模式 · 校验 ${commits.length} 个 commit`);
    let failed = 0;
    let skipped = 0;
    for (const c of commits) {
      const role = determineRole(c.author);
      const isForeign = !branchAncestors.has(c.sha);
      if (isForeign) {
        skipped++;
        continue;
      }
      log(`\n──── ${c.sha.slice(0, 8)} by ${c.author} (${role}) ────`);
      const ok = await runOnSingleSubject(c.subject, {
        role,
        ciMode: true,
        token,
        expectedIssueId,
        isForeignCommit: false,
      });
      if (!ok) failed++;
    }

    if (failed > 0) {
      log(
        `\n❌ 共 ${failed}/${commits.length} 个 commit 不合规${skipped > 0 ? `（${skipped} 个 merge 引入 commit 已豁免）` : ""}，CI 阻断`,
      );
      process.exit(1);
    }
    log(
      `\n✅ 全部 ${commits.length} 个 commit 合规${skipped > 0 ? `（${skipped} 个 merge 引入 commit 已豁免）` : ""}`,
    );
    process.exit(0);
  }

  // 模式 3：直接传 subject 字符串作为参数（用于本地调试）
  if (argv[0]) {
    const subject = argv[0];
    const username = getCurrentUserName();
    const role = determineRole(username);
    log(`🔍 直接校验模式 · user=${username} · role=${role}`);
    const ok = await runOnSingleSubject(subject, {
      role,
      ciMode: false,
      token,
      expectedIssueId,
    });
    process.exit(ok ? 0 : 1);
  }

  log(
    `❌ 用法：node check-commit-issue-ref.mjs <commit-msg-file 或 subject 字符串>`,
  );
  log(`   或：CI_MODE=1 BASE_REF=... HEAD_REF=... CNB_TOKEN=... 调用`);
  process.exit(2);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((e) => {
    log(`❌ 异常：${e.stack || e.message}`);
    process.exit(2);
  });
}
