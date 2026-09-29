import { createHash } from "node:crypto";

export class IssueContractError extends Error {
  constructor(message) {
    super(`AC_CANONICAL_INVALID: ${message}`);
    this.name = "IssueContractError";
  }
}

export function readIssueBody(issue) {
  for (const value of [issue?.body, issue?.description, issue?.content]) {
    if (typeof value === "string") return value;
  }
  return "";
}

/**
 * 结构化 canonical：识别 `## 验收标准` heading 下的 `- [ ] AC-N: <text>` 项，
 * 严格模式下要求恰好一个 heading。为了兼容 handoff 场景，heading 之后遇到下
 * 一个 heading 或空行不再终止，只是跳过；`Refs #<id>` 之类的说明行被视为
 * 结构化 AC 区结束。
 */
export function canonicalizeIssueAcceptanceCriteria(rawBody) {
  const normalized = String(rawBody || "")
    .replace(/\r\n?/gu, "\n")
    .normalize("NFC");
  const lines = normalized.split("\n");
  const headingIndexes = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index] === "## 验收标准") headingIndexes.push(index);
  }
  if (headingIndexes.length !== 1) {
    throw new IssueContractError(
      `expected exactly one ## 验收标准 section, received ${headingIndexes.length}`,
    );
  }

  const items = [];
  const seenIds = new Set();
  for (let index = headingIndexes[0] + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^#{1,2}(?:\s|$)/u.test(line)) break;
    if (line.trim() === "") continue;

    const match = line.match(/^- \[[ xX]\] (AC-[1-9][0-9]*):[ \t]+(.+)$/u);
    if (!match) {
      throw new IssueContractError(`invalid AC line: ${line}`);
    }
    const id = match[1];
    const text = match[2].trim();
    if (!text || seenIds.has(id)) {
      throw new IssueContractError(
        !text ? `empty AC text: ${id}` : `duplicate AC id: ${id}`,
      );
    }
    seenIds.add(id);
    items.push({ id, text });
  }
  if (items.length === 0) {
    throw new IssueContractError("acceptance criteria are empty");
  }

  const canonicalJson = JSON.stringify(items);
  const digest = `sha256:${createHash("sha256")
    .update(canonicalJson, "utf8")
    .digest("hex")}`;
  return { items, canonicalJson, digest, mode: "structured" };
}

/**
 * Legacy digest：不做结构化解析，直接对 Issue body 做归一化后 sha256。
 * 只要 body 内容没有变化，digest 就是稳定的。适用于：
 *   - 存量 Issue 的验收标准还没有结构化
 *   - 产品/设计师手写的 Issue，只有散文 AC
 *   - handoff / prototype 相关 Issue，AC 拆散在多个 heading 里
 * digest 格式：`legacy:sha256:<hex>`
 */
export function legacyIssueBodyDigest(rawBody) {
  const normalized = String(rawBody || "")
    .replace(/\r\n?/gu, "\n")
    .normalize("NFC")
    .trim();
  return `legacy:sha256:${createHash("sha256")
    .update(normalized, "utf8")
    .digest("hex")}`;
}

/**
 * 智能兜底：先尝试结构化 canonical，失败则退回到 legacy digest。
 * 返回结构：
 *   - structured：`{ mode: "structured", items, canonicalJson, digest }`
 *   - legacy：`{ mode: "legacy", digest, reason }`
 *
 * 调用方（PR 契约校验 / cmd-publish digest 计算）应把两种 digest 都视为合法，
 * 但只在 PR body 的 `AC-contract:` 一行按前缀存回（`sha256:` 或 `legacy:sha256:`）。
 */
export function computeAcContractDigest(rawBody) {
  try {
    return canonicalizeIssueAcceptanceCriteria(rawBody);
  } catch (error) {
    return {
      mode: "legacy",
      digest: legacyIssueBodyDigest(rawBody),
      reason: error.message || String(error),
    };
  }
}
