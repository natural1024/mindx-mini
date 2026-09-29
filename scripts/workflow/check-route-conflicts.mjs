#!/usr/bin/env node

/**
 * check-route-conflicts.mjs — 校验 mindx 前端路由是否使用了禁止前缀
 *
 * 禁止前缀：/tim, /api, /scenario, /components/docs
 * 校验范围：apps/mindx/src/routers/ 下的 Route path 定义
 * 不影响：后端接口请求路径（httpGet/httpPost 的 URL）
 *
 * 用法：
 *   node scripts/workflow/check-route-conflicts.mjs          # 校验全量路由文件
 *   USE_STAGED=1 node scripts/workflow/check-route-conflicts.mjs  # 仅校验 staged 改动涉及的路由文件
 *
 * 退出码：
 *   0 — 通过（无冲突 / 无路由文件变更）
 *   1 — 拦截（存在禁止前缀路由）
 *   2 — 缺少必要文件（容错放行）
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const FORBIDDEN_PREFIXES = ["/tim", "/components/docs", "/api", "/scenario"];

const ROUTER_DIR = path.resolve("apps/mindx/src/routers");

// ─── 收集待校验文件 ───────────────────────────────────────────

function getTargetFiles() {
  const useStaged = process.env.USE_STAGED === "1";

  if (!useStaged) {
    // 全量模式：扫描整个 routers 目录
    if (!fs.existsSync(ROUTER_DIR)) return [];
    return fs
      .readdirSync(ROUTER_DIR)
      .filter((f) => /\.(tsx?|jsx?)$/.test(f))
      .map((f) => path.join(ROUTER_DIR, f));
  }

  // Staged 模式：只看 staged 改动中涉及路由文件的
  let stagedFiles;
  try {
    stagedFiles = execSync("git diff --cached --name-only", {
      encoding: "utf-8",
    })
      .trim()
      .split("\n")
      .filter(Boolean);
  } catch {
    console.log("[check-route-conflicts] 无法获取 staged 文件，跳过校验。");
    return [];
  }

  return stagedFiles.filter((f) => /^apps\/mindx\/src\/routers\//.test(f));
}

// ─── 从文件内容中提取 Route path ──────────────────────────────

const ROUTE_PATH_RE = /path\s*=\s*{?["`]([^"`]+)["`]/g;

function extractRoutes(filePath) {
  const content = fs.readFileSync(filePath, "utf-8");
  const routes = [];
  let match;
  while ((match = ROUTE_PATH_RE.exec(content)) !== null) {
    routes.push({
      path: match[1],
      line: content.substring(0, match.index).split("\n").length,
    });
  }
  return routes;
}

// ─── 校验 ─────────────────────────────────────────────────────

function normalizeRoutePath(raw) {
  // react-router 嵌套路由不带前导 /，补上以便统一匹配
  return raw.startsWith("/") ? raw : `/${raw}`;
}

function checkRoutes(filePath, routes) {
  const violations = [];

  for (const route of routes) {
    const normalized = normalizeRoutePath(route.path);
    for (const prefix of FORBIDDEN_PREFIXES) {
      // 精确匹配：路由以禁止前缀开头，且后面是 / 或结尾
      // 例如 /api/user 冲突，/apiDocs 不冲突
      if (normalized === prefix || normalized.startsWith(`${prefix}/`)) {
        violations.push({
          prefix,
          path: route.path,
          line: route.line,
        });
      }
    }
  }

  return violations;
}

// ─── 主流程 ───────────────────────────────────────────────────

const files = getTargetFiles();

if (files.length === 0) {
  process.exit(0);
}

let hasViolation = false;

for (const file of files) {
  if (!fs.existsSync(file)) continue;

  const routes = extractRoutes(file);
  if (routes.length === 0) continue;

  const violations = checkRoutes(file, routes);

  if (violations.length > 0) {
    hasViolation = true;
    const relPath = path.relative(process.cwd(), file);
    console.log(`\n❌ ${relPath} 存在禁止前缀路由：`);
    for (const v of violations) {
      console.log(`   L${v.line}: path="${v.path}" → 冲突前缀 "${v.prefix}"`);
    }
  }
}

if (hasViolation) {
  console.log(
    `\n禁止使用以下前缀的前端路由：${FORBIDDEN_PREFIXES.map((p) => `"${p}"`).join(", ")}`,
  );
  console.log("如需绕过（不推荐）：git commit --no-verify\n");
  process.exit(1);
}

process.exit(0);
