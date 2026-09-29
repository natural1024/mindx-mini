#!/usr/bin/env node
/**
 * check-ui-components-additions.mjs
 *
 * 校验 `packages/ui-components/src/components/` 下：
 *   1. 是否有新增业务组件目录（规则 1）
 *
 * 落地规范：
 *   - docs/ui-components/atomic-component-criteria.md#1-准入清单
 *
 * 用途：
 *   - 业务组件一律放到 apps/mindx/src/components/ 或 page 私有 components/
 *   - ui-components 仅承载纯 UI 原子组件
 *
 * 输入：
 *   - BASE_REF 环境变量（默认 origin/main）
 *   - HEAD_REF 环境变量（默认 HEAD）
 *
 * 输出：
 *   - PASS / FAIL，含违规目录清单
 *
 * 退出码：
 *   - 0 = PASS
 *   - 1 = FAIL（含违规目录）
 *   - 2 = 异常（git 命令失败 / 无 base ref）
 *
 * ⛔ 无逃生舱：
 *   - 历史上的 [ui-components-allow] 标签已废弃，本脚本不再识别
 */

import { execSync } from "node:child_process";

const COLOR = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  bold: "\x1b[1m",
};

const BASE_REF = process.env.BASE_REF || "origin/main";
const HEAD_REF = process.env.HEAD_REF || "HEAD";
const TARGET_PREFIX = "packages/ui-components/src/components/";

function exec(cmd) {
  return execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
}

function tryExec(cmd) {
  try {
    return exec(cmd);
  } catch {
    return null;
  }
}

function pass(msg) {
  console.log(
    `${COLOR.green}✅ ui-components-additions check: PASS${COLOR.reset}`,
  );
  if (msg) console.log(msg);
  process.exit(0);
}

function abort(reason) {
  console.error(
    `${COLOR.red}⚠️  check skipped due to error: ${reason}${COLOR.reset}`,
  );
  process.exit(2);
}

function failHeader() {
  console.error(
    `${COLOR.red}${COLOR.bold}❌ ui-components-additions check: FAIL${COLOR.reset}\n`,
  );
}

function failRule1(violations) {
  failHeader();
  console.error(
    "【规则 1】禁止在 packages/ui-components/src/components/ 下新增业务组件目录。",
  );
  console.error("按 docs/ui-components/atomic-component-criteria.md §1：");
  console.error(
    "  - 业务组件放到 apps/mindx/src/components/ 或 page 私有 components/",
  );
  console.error(
    "  - packages/ui-components 仅承载通过六条准入清单的纯 UI 原子组件",
  );
  console.error(
    `  - ${COLOR.bold}本规则无逃生舱${COLOR.reset}：原 [ui-components-allow] 标签已废弃\n`,
  );
  console.error(`${COLOR.yellow}违规新增目录：${COLOR.reset}`);
  for (const dir of violations) {
    console.error(`  - ${dir}`);
  }
  console.error(
    `\n如确属纯 UI 原子组件，请按 atomic-component-criteria.md §1 逐项自证：implementation/production 在 PR 描述记录，prototype 在 Review 结果记录且不创建 PR。`,
  );
}

function parseDiffEntries(diffOutput) {
  // 返回 [{ status, path }]，过滤 ui-components/components/ 下的 ts/tsx/js/jsx
  return diffOutput
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const parts = line.split("\t");
      // rename 形如 "R100\told\tnew"，简化为按 new path 处理
      if (parts[0].startsWith("R") || parts[0].startsWith("C")) {
        return { status: parts[0][0], path: parts[2] };
      }
      return { status: parts[0], path: parts[1] };
    })
    .filter((e) => e.path && e.path.startsWith(TARGET_PREFIX));
}

function extractComponentName(path) {
  const rel = path.slice(TARGET_PREFIX.length);
  return rel.split("/")[0] || null;
}

function checkRule1(diffEntries) {
  // 新增的 .ts/.tsx 文件
  const addedFiles = diffEntries
    .filter((e) => e.status === "A")
    .map((e) => e.path)
    .filter((p) => /\.(tsx?|jsx?)$/.test(p));

  const violatingDirs = new Set();
  for (const filePath of addedFiles) {
    const firstSeg = extractComponentName(filePath);
    if (!firstSeg) continue;
    const dirPath = `${TARGET_PREFIX}${firstSeg}/`;
    const baseDir = tryExec(
      `git ls-tree -d ${BASE_REF} -- ${dirPath} 2>/dev/null`,
    );
    if (!baseDir || baseDir.trim() === "") {
      // 兜底：本目录是不是在 HEAD（前一个 commit）就已经存在，且本次 commit 没有
      // 再往里增加 / 修改文件？如果是，说明这个目录已经被前一个 commit 审过了，
      // 本次 commit 不再触发审查（典型场景：feature 分支前一个 commit 已合规新增
      // 一个原子组件，本次 commit 只改其他文件，三点 diff 仍把它列为 A）。
      const headDir = tryExec(
        `git ls-tree -d ${HEAD_REF} -- ${dirPath} 2>/dev/null`,
      );
      const stagedInDir = tryExec(
        `git diff --name-only --cached ${HEAD_REF} -- ${dirPath} 2>/dev/null`,
      );
      const unstagedInDir = tryExec(
        `git diff --name-only ${HEAD_REF} -- ${dirPath} 2>/dev/null`,
      );
      const headHasDir = headDir && headDir.trim() !== "";
      const noChangesThisCommit =
        (!stagedInDir || stagedInDir.trim() === "") &&
        (!unstagedInDir || unstagedInDir.trim() === "");
      if (headHasDir && noChangesThisCommit) {
        continue; // 已在前一个 commit 引入并审过，本次未变更，放行
      }
      violatingDirs.add(dirPath);
    }
  }
  return [...violatingDirs].sort();
}

function main() {
  const baseSha = tryExec(`git rev-parse ${BASE_REF}`);
  if (!baseSha) {
    abort(`base ref \`${BASE_REF}\` 不存在；可设置 BASE_REF 环境变量覆盖`);
  }

  const diffOutput = tryExec(
    `git diff --name-status ${BASE_REF}...${HEAD_REF}`,
  );
  if (diffOutput === null) {
    abort(`git diff ${BASE_REF}...${HEAD_REF} 失败`);
  }

  const diffEntries = parseDiffEntries(diffOutput);
  if (diffEntries.length === 0) {
    pass("（无 ui-components/components/ 下的改动）");
  }

  const rule1Violations = checkRule1(diffEntries);

  if (rule1Violations.length === 0) {
    pass("（规则 1 通过）");
  }

  failRule1(rule1Violations);
  process.exit(1);
}

try {
  main();
} catch (err) {
  abort(err.message);
}
