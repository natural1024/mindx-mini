import { execFileSync } from "node:child_process";

function git(cwd: string, args: string[]): string {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

/** 固定北京时间，避免本机与 CI 容器时区不同导致版本排查歧义。 */
function formatTime(date: Date): string {
  return date.toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

/** 与 Genie 一致，在前端构建阶段从 CI 工作区或本地应用目录读取 Git。 */
export function getBuildInfo(cwd: string) {
  const commitTime = git(cwd, ["log", "-1", "--format=%cI"]);
  const commitDate = new Date(commitTime);

  return {
    buildTime: formatTime(new Date()),
    gitBranch:
      git(cwd, ["symbolic-ref", "--short", "-q", "HEAD"]) ||
      process.env["CNB_BRANCH"] ||
      process.env["CI_COMMIT_REF_NAME"] ||
      "unknown",
    gitCommit:
      git(cwd, ["rev-parse", "--short", "HEAD"]) ||
      process.env["CNB_COMMIT"] ||
      process.env["CI_COMMIT_SHA"] ||
      "unknown",
    gitCommitTime: Number.isNaN(commitDate.getTime())
      ? "unknown"
      : formatTime(commitDate),
  };
}

/** 内联 script 使用 JSON 字面量；转义 HTML 结束标签与 JS 行分隔符。 */
export function serializeBuildInfo(
  info: ReturnType<typeof getBuildInfo>,
): string {
  return JSON.stringify(info)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
