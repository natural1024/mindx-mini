#!/usr/bin/env node
/**
 * check-i18n-literals.mjs
 *
 * Lightweight local i18n guard for staged production code.
 *
 * Scope:
 * - apps/mindx/src/**
 * - packages/ui-components/src/**
 * - packages/import-kit/src/**
 */

import { execFileSync, execSync } from "node:child_process";

const TARGET_PREFIXES = [
  "apps/mindx/src/",
  "packages/ui-components/src/",
  "packages/import-kit/src/",
];

const TEXT_FILE_RE = /\.(tsx?|jsx?)$/;
const CJK_RE = /[\u3400-\u9fff]/;
const QUOTE_RE = /["'`]/;

function exec(cmd) {
  return execSync(cmd, {
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function isMergeCommitInProgress() {
  try {
    execSync("git rev-parse -q --verify MERGE_HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
}

function isTargetFile(file) {
  if (!TEXT_FILE_RE.test(file)) return false;
  if (!TARGET_PREFIXES.some((prefix) => file.startsWith(prefix))) return false;
  if (/\/locales?\//.test(file)) return false;
  if (/\/test\//.test(file) || /\.(test|spec)\.[jt]sx?$/.test(file))
    return false;
  return true;
}

/**
 * 显式豁免标记：与 tools/script/i18n-shared.mjs（CI 全量扫描 i18n:check）
 * 使用完全相同的标记名与理由必填规则，确保同一条注释同时满足本地
 * pre-commit 校验与 CI 全量扫描，开发者不必为两套检查分别标注。
 *
 * - 逐行豁免 `i18n-check-ignore: <理由>`：写在命中行本身的行尾注释，
 *   或写在命中行的上一行；要求 `:` 后跟非空理由，避免开无审计的豁免后门。
 * - 整文件豁免 `i18n-check-ignore-file: <理由>`：文件内任意位置一行注释即可，
 *   跳过该文件的全部裸中文检测（如 sandbox-only dev tooling）。
 */
const IGNORE_LINE_MARKER_RE = /\/\/\s*i18n-check-ignore:\s*\S/;
// 文件级豁免必须是「整行注释 + 非空理由」，锚定行首，避免字符串字面量里
// 出现该子串（如 const x = "// i18n-check-ignore-file: y"）就误触发整文件豁免。
const IGNORE_FILE_MARKER_RE = /^\s*\/\/\s*i18n-check-ignore-file:\s*\S/;

function hasIgnoreLineMarker(line) {
  return IGNORE_LINE_MARKER_RE.test(line.trim());
}

/** 判断某文件（staged/索引区版本）是否带有整文件豁免标记，结果按文件缓存 */
const fileExemptCache = new Map();
function isFileExempt(file) {
  if (fileExemptCache.has(file)) return fileExemptCache.get(file);
  let exempt = false;
  try {
    // 用参数数组读取 staged 版本，避免把文件路径拼进 shell（路径可能含空格、$()、反引号等）。
    const source = execFileSync("git", ["show", `:${file}`], {
      encoding: "utf8",
      maxBuffer: 128 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
    });
    exempt = source
      .split("\n")
      .some((line) => IGNORE_FILE_MARKER_RE.test(line));
  } catch {
    // staged 版本读取失败（如文件已被删除）时按未豁免处理，交由其余规则判断
  }
  fileExemptCache.set(file, exempt);
  return exempt;
}

function shouldIgnoreLine(line, currentFile = "", prevLine = "") {
  const trimmed = line.trim();
  if (!trimmed) return true;
  // 注释行 / 块注释 / JSDoc 续行：基于原始行判断（stripInlineComment 不处理 /* 与 *）
  if (
    trimmed.startsWith("//") ||
    trimmed.startsWith("*") ||
    trimmed.startsWith("/*")
  )
    return true;
  // 显式豁免标记：命中行本身或其上一行带 `// i18n-check-ignore: <原因>`。
  // 标记写在注释里，必须基于原始行/上一行判断（不能用去注释的 codePart）。
  // 仅用于协议标识 / 枚举匹配值等「非用户可见文案的中文字面量」，
  // 必须写明原因，便于 code review 审计——不是通用的关闭开关。
  if (hasIgnoreLineMarker(trimmed) || hasIgnoreLineMarker(prevLine))
    return true;
  // 其余代码类豁免基于「去掉行内注释的代码部分」判断，避免行尾注释里的
  // $t( / useTranslation( / console. 等把本行整体放行，漏报真实未外化中文
  // （如 toast("保存成功"); // TODO: wrap with $t(）。
  const codeTrimmed = stripInlineComment(line).trim();
  if (codeTrimmed.startsWith("import ")) return true;
  if (codeTrimmed.includes("$t(") || codeTrimmed.includes("useTranslation("))
    return true;
  // i18n 翻译调用：`t("命名空间.key", "默认值")` / `$t("a.b", ...)`。
  // 编辑器等场景用 SDK `useT()` 的 `t()`，第二参是 i18next defaultValue（真实展示文案）。
  // 仅当第一个实参是「带点的 i18n key」时豁免；裸中文字面量（如 "确定"、toast("操作成功")）
  // 不含命名空间 key，仍会被拦截，避免开豁免后门。
  if (
    /(?<![\w$])\$?t\(\s*["'][A-Za-z_$][\w$-]*(?:\.[\w$-]+)+["']/.test(
      codeTrimmed,
    )
  )
    return true;
  if (codeTrimmed.includes("console.")) return true;
  // icon-catalog / icon-requests 中的 description/intent 是开发者元数据，非用户可见文案
  if (
    /\/icons\/icon-(catalog|requests)\.ts$/.test(currentFile) &&
    /\b(description|intent):\s*["'`]/.test(codeTrimmed)
  )
    return true;
  return false;
}

/**
 * 移除「字符串匹配方法」的字符串实参，再交给 CJK 检测。
 *
 * `title.includes("微信")` / `url.startsWith("飞书")` 之类是**关键字匹配逻辑**
 * （判断来源、命中分类），中文只是被匹配的关键字，不是用户可见文案，应豁免。
 *
 * 仅剥离这类匹配方法的字符串实参，保留行内其余内容——因此
 * `list.includes("微信") ? "成功" : "失败"` 中的 "成功"/"失败" 仍会被检出，
 * 不会因为一行里出现 `.includes(` 就整行放行，避免开豁免后门。
 */
function stripMatchingCallArgs(content) {
  return content.replace(
    /\.(includes|startsWith|endsWith|indexOf|lastIndexOf|search)\(\s*(["'`])(?:\\.|(?!\2).)*\2\s*\)/g,
    ".$1()",
  );
}

/**
 * 剥离行内注释（// 之后的部分），但跳过字符串字面量内的 //。
 * 用于排除行内代码注释中的中文（注释非用户可见文案，不应触发 i18n 校验）。
 */
function stripInlineComment(content) {
  let inString = false;
  let stringChar = "";
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (inString) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === stringChar) {
        inString = false;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = true;
      stringChar = ch;
      continue;
    }
    if (ch === "/" && content[i + 1] === "/") {
      return content.slice(0, i);
    }
  }
  return content;
}

/**
 * 计算一行文本中 $t( 调用引入的净括号深度变化。
 * 返回 { insideTCall, depthDelta }：
 *   - insideTCall: 该行内容是否处于某个 $t( 调用内部（含本行开启的情况）
 *   - depthDelta: 本行结束后 $t( 括号深度的净变化（正数=未闭合，0=已配平）
 *
 * 只追踪 $t( 触发的括号栈，不追踪普通函数调用。
 * 字符串字面量内的括号通过简单的引号状态机跳过。
 */
function analyzeTCallLine(content) {
  let depth = 0; // 本行 $t( 净深度变化
  let inString = false; // 是否在字符串字面量内
  let stringChar = "";
  let lineHasOpenT = false; // 本行是否出现了 $t(

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];

    if (inString) {
      if (ch === "\\") {
        i++; // 跳过转义字符
        continue;
      }
      if (ch === stringChar) {
        inString = false;
      }
      continue;
    }

    // 检测字符串开始
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = true;
      stringChar = ch;
      continue;
    }

    // 检测 $t( 模式（$ 后跟 t 后跟 ( ）
    if (ch === "$" && content[i + 1] === "t" && content[i + 2] === "(") {
      lineHasOpenT = true;
      depth++;
      i += 2; // 跳过 t(
      continue;
    }

    if (ch === "(" && lineHasOpenT && depth > 0) {
      depth++;
      continue;
    }

    if (ch === ")" && depth > 0) {
      depth--;
      continue;
    }
  }

  return { insideTCall: lineHasOpenT || depth > 0, depthDelta: depth };
}

function parseDiff(diff) {
  const violations = [];
  let currentFile = "";
  let newLine = 0;
  // 跨行 $t() 调用的括号深度（>0 表示当前处于某个 $t() 调用内部）
  let tCallDepth = 0;
  // 上一条新增（+）行的原始内容：用于识别写在声明行上一行的 i18n-check-ignore 标记
  let prevAddedLine = "";

  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ b/")) {
      currentFile = line.slice("+++ b/".length);
      newLine = 0;
      tCallDepth = 0;
      prevAddedLine = "";
      continue;
    }

    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      newLine = Number(hunk[1]);
      tCallDepth = 0;
      prevAddedLine = "";
      continue;
    }

    if (!currentFile || !isTargetFile(currentFile)) {
      continue;
    }

    if (line.startsWith("+") && !line.startsWith("+++")) {
      const content = line.slice(1);
      const { insideTCall, depthDelta } = analyzeTCallLine(content);

      // 如果本行之前已在 $t() 内部，或本行开启了 $t(，则该行的中文受保护
      const protectedByTCall = tCallDepth > 0 || insideTCall;

      // 先剥离行内注释，再剥离字符串匹配方法（includes/startsWith/...）的字符串实参，
      // 然后判定 CJK：注释中文与关键字匹配逻辑都不是用户可见文案，应豁免。
      const codePart = stripInlineComment(content);
      const scannable = stripMatchingCallArgs(codePart);

      if (
        CJK_RE.test(scannable) &&
        QUOTE_RE.test(scannable) &&
        !shouldIgnoreLine(content, currentFile, prevAddedLine) &&
        !protectedByTCall
      ) {
        violations.push({
          file: currentFile,
          line: newLine,
          content: content.trim(),
        });
      }

      // 更新跨行 $t() 深度
      if (insideTCall) {
        tCallDepth += depthDelta;
      }
      // 安全兜底：深度不应为负
      if (tCallDepth < 0) tCallDepth = 0;

      prevAddedLine = content;
      newLine++;
      continue;
    }

    if (!line.startsWith("-")) {
      newLine++;
    }
  }

  return violations;
}

function main() {
  if (isMergeCommitInProgress()) {
    console.log("[i18n-literals] SKIP: merge commit in progress");
    process.exit(0);
  }

  let diff = "";
  try {
    diff = exec(
      "git diff --cached --unified=0 --diff-filter=ACMRT -- '*.ts' '*.tsx' '*.js' '*.jsx'",
    );
  } catch (err) {
    console.error(`[i18n-literals] 无法读取 staged diff：${err.message}`);
    process.exit(2);
  }

  if (!diff.trim()) {
    process.exit(0);
  }

  const allViolations = parseDiff(diff);
  // 整文件豁免（i18n-check-ignore-file）：与 CI 全量扫描（i18n:check）保持一致，
  // 跳过整份文件不打算做 i18n 的场景（如 sandbox-only dev tooling）。
  const violations = allViolations.filter((v) => !isFileExempt(v.file));
  if (violations.length === 0) {
    console.log("[i18n-literals] PASS");
    process.exit(0);
  }

  console.error(
    "\n❌ i18n staged check: 检测到新增中文字符串字面量未包裹 $t(...)",
  );
  console.error("请将生产代码中的用户可见中文文案放入 @mindx/i18n 翻译函数。");
  console.error(
    "如确认不是用户可见文案，请调整代码结构或在脚本中补充明确豁免规则。\n",
  );

  for (const item of violations) {
    console.error(`  - ${item.file}:${item.line}`);
    console.error(`    ${item.content}`);
  }

  console.error("");
  process.exit(1);
}

main();
