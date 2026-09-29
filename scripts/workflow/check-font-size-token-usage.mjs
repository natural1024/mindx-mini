#!/usr/bin/env node

/**
 * check-font-size-token-usage.mjs — 校验字号 / 间距类 CSS 属性是否通过 Token / calc / rem 消费
 *
 * 设计目的：
 *   字号跟随系统要求 font-size 和间距类属性必须通过以下合法方式消费：
 *     1. var(--xxx)（推荐：Token / CSS 变量）
 *     2. calc(... 内部通常含 var(--font-scale) 或 var(--font-offset))
 *     3. rem 单位（浏览器原生根字号跟随）
 *     4. % 单位（相对父级百分比）
 *     5. 无单位值（0 / auto / normal / 1.5 等）
 *     6. 命名值或数学函数（small / clamp() / max() / min() / env() 等）
 *   直接写 font-size: 14px 或 padding: 8px 字面 px 会绕过字号跟随机制，
 *   导致档位切换后视觉不同步。
 *
 * 校验范围（默认 staged .less / .css 改动）：
 *   - 字号：font-size
 *   - 间距：margin / margin-* / padding / padding-* / gap / row-gap / column-gap
 *   - 定位：top / right / bottom / left（绝对定位偏移参与字号跟随）
 *
 * 不校验（不参与字号跟随的属性）：
 *   - width / height / min-* / max-* / inset / inset-*（几何尺寸 / 复合定位，
 *     设计上多为固定布局值，不跟随字号档位）
 *   - border / border-*-width（1px 边框是设计规范）
 *   - border-radius（圆角不跟随）
 *   - box-shadow / filter / transform（不在 token 系统）
 *   - line-height / letter-spacing（不跟随）
 *
 * 豁免机制：
 *   在违规行上一行加注释即可豁免单行：
 *     /* stylelint-disable-next-line font-token *\/
 *     font-size: 14px;
 *
 * 用法：
 *   node scripts/workflow/check-font-size-token-usage.mjs          # 全量校验
 *   USE_STAGED=1 node scripts/workflow/check-font-size-token-usage.mjs  # 仅校验 staged 改动（pre-commit 默认）
 *
 * 退出码：
 *   0 — 通过（无违规 / 无相关文件改动）
 *   1 — 拦截（检测到字面 px 的字号或间距属性）
 *   2 — 依赖异常（容错放行）
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// ─── 校验目标属性 ──────────────────────────────────────────────
// 这些属性的 px 值必须走 Token / calc / rem / %，不允许裸字面量
// 注：width / height / inset 等几何尺寸不在校验范围（设计上多为固定布局值）
const TARGET_PROPERTIES = new Set([
  "font-size",
  "margin",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "padding",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "gap",
  "row-gap",
  "column-gap",
  "top",
  "right",
  "bottom",
  "left",
]);

// ─── 豁免注释 ────────────────────────────────────────────────
// 命中下面任一注释即豁免本行
const EXEMPT_COMMENT_PATTERNS = [
  /stylelint-disable-next-line\s+font-token/i,
  /font-token:\s*allow/i,
  /@font-token-allow/i,
];

// ─── 合规判定 ────────────────────────────────────────────────
// 返回 true = 合规（不报警）；返回 false = 违规
function isCompliantValue(rawValue) {
  const value = rawValue.trim();
  if (!value) return true;

  // 1. 含 CSS 变量 var(--xxx) → 合规
  if (/var\s*\(--/i.test(value)) return true;

  // 2. 含 calc() → 合规
  if (/calc\s*\(/i.test(value)) return true;

  // 3. 含 clamp() / max() / min() / env() 等数学函数 → 合规
  if (/(clamp|max|min|env|fit-content)\s*\(/i.test(value)) return true;

  // 4. 含 rem 单位 → 合规（浏览器原生根字号跟随）
  if (/\d+(\.\d+)?rem\b/i.test(value)) return true;

  // 5. 含 % 单位 → 合规（相对父级百分比）
  if (/\d+(\.\d+)?%/.test(value)) return true;

  // 6. 不含 px 单位 → 合规（无单位值 0/1.5、命名值 small/auto/inherit 等、em 单位）
  //    em 通常作为相对父字号单位也算合规消费，与 rem 类似处理
  if (!/\d+(\.\d+)?px\b/i.test(value)) return true;

  // 走到这里说明含字面 px → 违规
  return false;
}

// ─── 收集待校验文件 ────────────────────────────────────────────

function getTargetFiles() {
  const useStaged = process.env.USE_STAGED === "1";

  if (!useStaged) {
    // 全量模式：扫描 tracked .less / .css（排除 node_modules / dist / lib）
    try {
      const out = execSync(
        "git ls-files 'apps/**/*.less' 'apps/**/*.css' 'packages/**/*.less' 'packages/**/*.css'",
        { encoding: "utf-8" },
      );
      return out
        .trim()
        .split("\n")
        .filter(Boolean)
        .filter((f) => !/node_modules|\/dist\/|\/lib\//.test(f));
    } catch {
      console.log(
        "[check-font-size-token-usage] 无法获取 tracked 文件，跳过校验。",
      );
      return [];
    }
  }

  // Staged 模式：只看 staged .less / .css 改动
  let stagedFiles;
  try {
    stagedFiles = execSync("git diff --cached --name-only", {
      encoding: "utf-8",
    })
      .trim()
      .split("\n")
      .filter(Boolean);
  } catch {
    console.log(
      "[check-font-size-token-usage] 无法获取 staged 文件，跳过校验。",
    );
    return [];
  }

  return stagedFiles.filter((f) => /\.(less|css)$/.test(f));
}

// ─── 解析文件违规 ────────────────────────────────────────────

// 匹配 CSS 属性声明：<prop>: <value>;
// 只关心目标属性；缩进、注释、嵌套都不影响匹配
const DECL_RE = new RegExp(
  `(^|\\s)(${[...TARGET_PROPERTIES].join("|")})\\s*:\\s*([^;]+);`,
  "gi",
);

// 从 git diff --cached -U0 提取指定文件的「新增行」（行号 + 内容）
// 返回 [{ line: number, text: string }]
function getAddedLines(filePath) {
  let diff;
  try {
    diff = execSync(`git diff --cached -U0 -- "${filePath}"`, {
      encoding: "utf-8",
    });
  } catch {
    return [];
  }
  if (!diff) return [];

  const added = [];
  let lineNo = 0;
  let inHunk = false;

  for (const line of diff.split("\n")) {
    // hunk header: @@ -a,b +c,d @@
    const hunkMatch = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunkMatch) {
      lineNo = parseInt(hunkMatch[1], 10);
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;

    if (line.startsWith("+")) {
      added.push({ line: lineNo, text: line.slice(1) });
      lineNo++;
    } else if (line.startsWith("-")) {
      // 删除行不增加 lineNo
    } else if (line.startsWith(" ")) {
      lineNo++;
    } else if (line === "\\ No newline at end of file") {
      // skip
    }
  }

  return added;
}

// 对 staged 新增行做校验
function findViolationsInStaged(filePath) {
  const addedLines = getAddedLines(filePath);
  if (addedLines.length === 0) return [];

  // 读全量内容（用于读上一行判断豁免注释）
  const content = fs.readFileSync(filePath, "utf-8");
  const allLines = content.split("\n");

  const violations = [];

  for (const { line: lineNo, text } of addedLines) {
    // 在新增行文本上匹配目标属性
    DECL_RE.lastIndex = 0;
    const match = DECL_RE.exec(text);
    if (!match) continue;

    const prop = match[2].toLowerCase();
    const value = match[3];

    if (!TARGET_PROPERTIES.has(prop)) continue;
    if (isCompliantValue(value)) continue;

    // 上一行（在新代码里）做豁免判定
    const prevLine = lineNo > 1 ? (allLines[lineNo - 2] ?? "") : "";
    const isExempt = EXEMPT_COMMENT_PATTERNS.some((re) => re.test(prevLine));
    if (isExempt) continue;

    violations.push({
      line: lineNo,
      prop,
      value: value.trim(),
    });
  }

  return violations;
}

// 全量模式：扫描整个文件
function findViolationsInFull(filePath) {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const violations = [];

  let match;
  DECL_RE.lastIndex = 0;
  while ((match = DECL_RE.exec(content)) !== null) {
    const prop = match[2].toLowerCase();
    const value = match[3];

    if (!TARGET_PROPERTIES.has(prop)) continue;
    if (isCompliantValue(value)) continue;

    const lineNo = content.substring(0, match.index).split("\n").length;

    const prevLine = lineNo > 1 ? lines[lineNo - 2] : "";
    const isExempt = EXEMPT_COMMENT_PATTERNS.some((re) => re.test(prevLine));
    if (isExempt) continue;

    violations.push({
      line: lineNo,
      prop,
      value: value.trim(),
    });
  }

  return violations;
}

// ─── 主流程 ───────────────────────────────────────────────────

const files = getTargetFiles();

if (files.length === 0) {
  process.exit(0);
}

const useStaged = process.env.USE_STAGED === "1";
let hasViolation = false;
let totalViolations = 0;

for (const file of files) {
  if (!fs.existsSync(file)) continue;

  const violations = useStaged
    ? findViolationsInStaged(file)
    : findViolationsInFull(file);

  if (violations.length === 0) continue;

  hasViolation = true;
  totalViolations += violations.length;

  const relPath = path.relative(process.cwd(), file);
  console.log(
    `\n❌ ${relPath} 存在字面 px 的字号/间距属性（需用 Token / calc / rem / %）：`,
  );
  for (const v of violations) {
    console.log(`   L${v.line}: ${v.prop}: ${v.value}`);
  }
  console.log(
    `   提示：如确需字面 px，可在上一行加注释豁免： /* stylelint-disable-next-line font-token */`,
  );
}

if (hasViolation) {
  console.log("");
  console.log(
    `共 ${totalViolations} 处违规。字号 / 间距类属性必须通过 Token (var(--fs-*) / var(--space-*))、calc()、rem 或 % 消费，`,
  );
  console.log(
    `禁止裸字面 px 值（会绕过字号档位跟随机制，导致切换档位后视觉不同步）。`,
  );
  console.log("如需绕过：git commit --no-verify（不推荐）\n");
  process.exit(1);
}

process.exit(0);
