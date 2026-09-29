#!/usr/bin/env node
/**
 * check-reporter-dependency-type.mjs
 *
 * 校验 @mindx/reporter 在 workspace 内的依赖类型：
 *
 *   - apps/*           允许放 dependencies（终端应用，宿主自己装 reporter）
 *   - packages/reporter 自身豁免
 *   - packages/*       禁止放 dependencies / devDependencies
 *                      必须放 peerDependencies
 *
 * 落地动机：
 *
 *   reporter 是带运行时状态的单例（aegis 实例 + 全局 init 标记），
 *   如果某个共享包（如 core-data）把它放 dependencies，那么：
 *     1. 该包 build 后 lib 中会内嵌一份 reporter（虽然有 globalThis 兜底
 *        能避免行为错乱，但仍然会让产物变大、增加心智负担）
 *     2. npm 化场景下宿主版本与 reporter 版本协商失效
 *
 *   peerDependency 是表达"我用它但由宿主提供"的标准方式，配合
 *   tools/build-config/rspack/library.ts 的 externalize 行为，
 *   能保证 reporter 永远由顶层 app 提供单一实例。
 *
 * 配套机制：
 *   - tools/build-config/rspack/library.ts buildExternals
 *   - packages/reporter/src/index.ts 的 globalThis 兜底
 *   - .codebuddy/rules/* （可补一条 reporter 落点规则）
 *
 * 退出码：
 *   - 0 = PASS
 *   - 1 = FAIL（含违规清单）
 *   - 2 = 异常（fs / json 解析失败）
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

const REPORTER_PKG = "@mindx/reporter";

const COLOR = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  bold: "\x1b[1m",
};

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function scanWorkspacePackages() {
  const results = [];
  for (const group of ["apps", "packages"]) {
    const groupDir = path.join(repoRoot, group);
    if (!fs.existsSync(groupDir)) continue;
    for (const name of fs.readdirSync(groupDir)) {
      const pkgPath = path.join(groupDir, name, "package.json");
      if (!fs.existsSync(pkgPath)) continue;
      results.push({
        group, // "apps" | "packages"
        name, // 目录名
        absPath: pkgPath,
        relPath: path.relative(repoRoot, pkgPath),
        json: readJson(pkgPath),
      });
    }
  }
  return results;
}

function main() {
  let pkgs;
  try {
    pkgs = scanWorkspacePackages();
  } catch (err) {
    console.error(
      `${COLOR.red}[reporter-dep-check] 扫描 workspace 失败:${COLOR.reset}`,
      err,
    );
    process.exit(2);
  }

  const violations = [];

  for (const pkg of pkgs) {
    // 跳过 reporter 自身
    if (pkg.json.name === REPORTER_PKG) continue;

    const inDeps = !!pkg.json.dependencies?.[REPORTER_PKG];
    const inDevDeps = !!pkg.json.devDependencies?.[REPORTER_PKG];
    const inPeerDeps = !!pkg.json.peerDependencies?.[REPORTER_PKG];

    if (!inDeps && !inDevDeps && !inPeerDeps) continue; // 不消费 reporter，跳过

    if (pkg.group === "apps") {
      // 终端应用层：允许放 dependencies；不允许同时放 peerDependencies 与 dependencies
      if (inDevDeps) {
        violations.push({
          file: pkg.relPath,
          name: pkg.json.name,
          reason: `${REPORTER_PKG} 不应放在 devDependencies，apps 层请用 dependencies`,
        });
      }
      // apps 既能 dep 也能 peerDep（少数 lib-style 的 app 可能用 peer），不报错
    } else {
      // 共享包层（packages/*）：必须放 peerDependencies
      if (inDeps) {
        violations.push({
          file: pkg.relPath,
          name: pkg.json.name,
          reason: `${REPORTER_PKG} 在共享包内必须声明为 peerDependencies，当前在 dependencies`,
        });
      }
      if (inDevDeps) {
        violations.push({
          file: pkg.relPath,
          name: pkg.json.name,
          reason: `${REPORTER_PKG} 在共享包内必须声明为 peerDependencies，当前在 devDependencies`,
        });
      }
      if (!inPeerDeps && !inDeps && !inDevDeps) {
        // 应该到不了这里，inDeps/inDevDeps/inPeerDeps 至少有一个为 true
      }
    }
  }

  if (violations.length > 0) {
    console.error(
      `${COLOR.red}${COLOR.bold}[reporter-dep-check] FAIL${COLOR.reset} 发现 ${violations.length} 处违规：\n`,
    );
    for (const v of violations) {
      console.error(`  ${COLOR.yellow}${v.file}${COLOR.reset}  (${v.name})`);
      console.error(`    ${v.reason}\n`);
    }
    console.error(
      `${COLOR.bold}修复建议：${COLOR.reset}把 "${REPORTER_PKG}" 从 dependencies / devDependencies 移到 peerDependencies。\n` +
        `背景：reporter 是带状态的单例包，必须由顶层 app 提供唯一实例。详见 packages/reporter/src/index.ts 顶部注释。`,
    );
    process.exit(1);
  }

  console.log(
    `${COLOR.green}${COLOR.bold}[reporter-dep-check] PASS${COLOR.reset}  扫描了 ${pkgs.length} 个 workspace 包，未发现违规。`,
  );
  process.exit(0);
}

main();
