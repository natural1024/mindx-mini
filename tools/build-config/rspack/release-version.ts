/**
 * 构建期版本号生成
 *
 * 用途：
 *   注入到 HTML 模板（通过 HtmlRspackPlugin.templateParameters），
 *   最终在浏览器侧暴露为 `window.__globalReleaseVersion`，
 *   供性能上报、反馈、日志、监控等场景标记当前 web 制品版本。
 *
 * 输出格式：
 *   `${YYYYMMDD-HHmm}-${projectName}-${branchName}-${commitHash}`
 *   例：`20260429-1845-mindx-master-21a6f55`
 *
 * 设计要点：
 *   - 同步 execSync：本函数只在构建启动期调用一次（webpack/rspack
 *     plugin 初始化阶段），不影响 incremental rebuild 性能
 *   - 静默降级：git 命令失败（detached HEAD / shallow clone / 无 git）时
 *     回退为 `empty-branch` / `empty-hash`，不阻塞构建
 *   - 工作区根：默认取 monorepo 仓库根（本文件向上 3 层），所有 app 共享同一个
 *     git 上下文；如需覆盖可显式传入 `cwd`
 *
 * 参考实现：smart-canvas/build/index.ts 的 getReleaseVersion
 */
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// tools/build-config/rspack → 仓库根
const REPO_ROOT = path.resolve(__dirname, "../../../");

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function formatTimestamp(d: Date = new Date()): string {
  return (
    `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}` +
    `-${pad2(d.getHours())}${pad2(d.getMinutes())}`
  );
}

function safeExec(cmd: string, cwd: string): string {
  try {
    return execSync(cmd, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

export interface GetReleaseVersionOptions {
  /** 项目名（写入版本字符串），通常用 app 包名后缀，如 'mindx' / 'prototype' */
  projectName: string;
  /** git 仓库工作目录，默认取 monorepo 仓库根 */
  cwd?: string;
}

export function getReleaseVersion({
  projectName,
  cwd = REPO_ROOT,
}: GetReleaseVersionOptions): string {
  const commitHash =
    safeExec("git rev-parse --short HEAD", cwd) || "empty-hash";
  // 优先用 symbolic-ref；CI / detached HEAD 下回退到 CNB / 通用 CI 环境变量
  const rawBranch =
    safeExec("git symbolic-ref --short -q HEAD", cwd) ||
    process.env["CNB_BRANCH"] ||
    process.env["CI_COMMIT_REF_NAME"] ||
    "";
  const branchName = rawBranch
    ? rawBranch.replace(/\s+/g, "").replace(/\//g, "-")
    : "empty-branch";

  return `${formatTimestamp()}-${projectName}-${branchName}-${commitHash}`;
}
