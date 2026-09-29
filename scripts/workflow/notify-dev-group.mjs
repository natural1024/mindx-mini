#!/usr/bin/env node
/**
 * 研发群企微机器人通知脚本（CNB 事件驱动）。
 *
 * 复刻工蜂「创建 Issue / 发起 MR 时通知研发群」的能力。CNB 没有平台级
 * 事件订阅开关，改由 .cnb.yml 声明事件流水线，事件发生时跑本脚本，
 * 直接 POST 企微群机器人 Webhook 推送卡片。
 *
 * 支持事件（由内置变量 CNB_EVENT 分流）：
 *   - issue.open            → 新 Issue 创建（天然只触发一次）
 *   - pull_request.target   → 新 PR 创建（需降噪，仅 action=opened 才推送）
 *   - pull_request.merged   → PR 合入（天然只触发一次）
 *
 * 降噪说明：CNB 无「仅 PR 创建」纯事件，pull_request(.target) 会在
 * 创建 / 重开 / 源分支 push 时都触发。用 CNB_PULL_REQUEST_ACTION === "opened"
 * 过滤掉 synchronize(源分支 push) 等，保证「首次创建才通知」。
 *
 * 安全：
 *   - Webhook key 来自 secret（MINDX_VIBE_WEBHOOK_KEY，经 imports 注入），
 *     绝不明文进仓库，也绝不打印完整 URL / key。
 *   - 通知目标域名固定为企微开放接口，非用户可控，无 SSRF 风险。
 *
 * 本脚本永不阻塞流水线：任何异常都以 exit 0 结束。
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

import { isPlaceholderPrTitle } from "./pr-title.mjs";

const WECOM_WEBHOOK_BASE = "https://qyapi.weixin.qq.com/cgi-bin/webhook/send";

function envUrl(env) {
  const protocol = env.CNB_WEB_PROTOCOL || "https";
  const host = env.CNB_WEB_HOST || "cnb.woa.com";
  const repo = env.CNB_REPO_SLUG || "";

  // CNB_EVENT_URL：合并类事件→PR 链接；Issue 类→Issue 链接。优先使用。
  if (env.CNB_EVENT_URL) return env.CNB_EVENT_URL;

  const event = env.CNB_EVENT || "";
  if (event.startsWith("issue") && env.CNB_ISSUE_IID) {
    return `${protocol}://${host}/${repo}/-/issues/${env.CNB_ISSUE_IID}`;
  }
  if (event.startsWith("pull_request") && env.CNB_PULL_REQUEST_IID) {
    return `${protocol}://${host}/${repo}/-/pulls/${env.CNB_PULL_REQUEST_IID}`;
  }
  return `${protocol}://${host}/${repo}`;
}

function repoName(env) {
  return env.CNB_REPO_NAME || env.CNB_REPO_SLUG || "仓库";
}

/**
 * 根据 CNB_EVENT 构造企微 markdown 卡片内容。
 * 返回 null 表示当前事件不需要通知（如 PR 的非首次触发）。
 */
export function buildMessage(env = process.env, logger = console) {
  const event = env.CNB_EVENT || "";
  const url = envUrl(env);
  const repo = repoName(env);

  // Issue 创建
  if (event.startsWith("issue")) {
    const iid = env.CNB_ISSUE_IID || "";
    const title = env.CNB_ISSUE_TITLE || "(无标题)";
    const owner = env.CNB_ISSUE_OWNER || "未知";
    return (
      `📌 **新 Issue** \`${repo}\` #${iid}\n` +
      `> **标题**：${title}\n` +
      `> **创建人**：${owner}\n` +
      `> [查看详情](${url})`
    );
  }

  // PR 合入
  if (event === "pull_request.merged") {
    const iid = env.CNB_PULL_REQUEST_IID || "";
    const title = env.CNB_PULL_REQUEST_TITLE || "(无标题)";
    const proposer = env.CNB_PULL_REQUEST_PROPOSER || "未知";
    const merger = env.CNB_BUILD_USER || "";
    const source = env.CNB_PULL_REQUEST_BRANCH || "";
    const target = env.CNB_BRANCH || "";
    const branchLine =
      source && target ? `\n> **分支**：${source} → ${target}` : "";
    const mergerLine = merger ? `\n> **合并人**：${merger}` : "";
    return (
      `✅ **PR 已合入** \`${repo}\` #${iid}\n` +
      `> **标题**：${title}\n` +
      `> **发起人**：${proposer}${mergerLine}${branchLine}\n` +
      `> [查看详情](${url})`
    );
  }

  // PR 创建（降噪：仅首次创建 action=opened 才推送）
  if (event.startsWith("pull_request")) {
    const action = env.CNB_PULL_REQUEST_ACTION || "";
    if (action !== "opened") {
      logger.log(
        `Skip PR notify: action=${action || "(empty)"} is not "opened" (denoise source-branch push).`,
      );
      return null;
    }
    const iid = env.CNB_PULL_REQUEST_IID || "";
    const title = env.CNB_PULL_REQUEST_TITLE || "";
    if (isPlaceholderPrTitle(title)) {
      logger.warn(
        `Skip PR notify: opened event has an empty or placeholder title for #${iid || "(unknown)"}.`,
      );
      return null;
    }
    const proposer = env.CNB_PULL_REQUEST_PROPOSER || "未知";
    const source = env.CNB_PULL_REQUEST_BRANCH || "";
    const target = env.CNB_BRANCH || "";
    const branchLine =
      source && target ? `\n> **分支**：${source} → ${target}` : "";
    return (
      `🔀 **新 PR** \`${repo}\` #${iid}\n` +
      `> **标题**：${title}\n` +
      `> **发起人**：${proposer}${branchLine}\n` +
      `> [查看详情](${url})`
    );
  }

  logger.log(`Skip: unsupported CNB_EVENT="${event}"`);
  return null;
}

async function sendToWecom(content) {
  const key = process.env.MINDX_VIBE_WEBHOOK_KEY || "";
  if (!key) {
    console.warn(
      "Skip: MINDX_VIBE_WEBHOOK_KEY missing (check x-team-secrets/mindx_envs.yml imports).",
    );
    return;
  }

  const res = await fetch(
    `${WECOM_WEBHOOK_BASE}?key=${encodeURIComponent(key)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ msgtype: "markdown", markdown: { content } }),
    },
  );

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!res.ok) {
    console.warn(`Wecom webhook HTTP ${res.status}: ${text}`);
    return;
  }
  // 企微成功返回 { errcode: 0, errmsg: "ok" }
  if (data && typeof data === "object" && data.errcode !== 0) {
    console.warn(`Wecom webhook business error: ${JSON.stringify(data)}`);
    return;
  }
  console.log("Dev group notification sent.");
}

async function main() {
  console.log(
    `notify-dev-group: CNB_EVENT=${process.env.CNB_EVENT || "(empty)"}`,
  );
  const content = buildMessage();
  if (!content) return;
  await sendToWecom(content);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((err) => {
    // 通知失败绝不阻塞流水线
    console.error("notify-dev-group failed (non-blocking):");
    console.error(err?.stack || err?.message || err);
    process.exit(0);
  });
}
