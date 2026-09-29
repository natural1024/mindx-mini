#!/usr/bin/env node
/**
 * Advance one Issue from 开发中 to 待发布 after a production PR merge.
 *
 * The merge event is already irreversible, so malformed metadata is logged and
 * skipped rather than guessed from commits. This keeps the state machine
 * fail-closed and identical to the pre-merge PR contract parser.
 */

import { pathToFileURL } from "node:url";
import { isPrototypeBranch } from "./check-prototype-pr-policy.mjs";
import {
  parseAcContractDigest,
  parseSingleIssueRef,
  parseTargetLabel,
  TargetLabelValidationError,
  validatePrRouteContract,
} from "./check-mr-sync-status.mjs";
import {
  canonicalizeIssueAcceptanceCriteria,
  readIssueBody,
} from "./issue-contract.mjs";
import {
  assertInfrastructureChangedPaths,
  resolvePullRequestChangedPaths,
} from "./infrastructure-route.mjs";
import {
  getIssueState,
  isIssueStateLabel,
  transitionIssueStateLabels,
} from "./issue-state.mjs";
import { createPlatformClient, platformUtils } from "./platform-client.mjs";

const NOTE_PR_IID_PATTERN = /^🔗 cmd-publish:\s*PR\s*#(\d+)\b/m;

function logSection(logger, title) {
  logger.log("");
  logger.log(`-- ${title} --`);
}

function resolvePrIid(env) {
  const raw = env.CNB_PULL_REQUEST_IID || "";
  return /^[0-9]+$/.test(raw) ? raw : "";
}

function prBody(pr) {
  return pr?.body || pr?.description || "";
}

function prTitle(pr, env) {
  return pr?.title || env.CNB_PULL_REQUEST_TITLE || "";
}

function prSourceBranch(pr, env) {
  return (
    env.CNB_PULL_REQUEST_BRANCH ||
    pr?.source_branch ||
    pr?.sourceBranch ||
    pr?.head?.ref ||
    pr?.head?.name ||
    pr?.source?.branch ||
    ""
  );
}

function prTargetBranch(pr, env) {
  return (
    env.CNB_BRANCH ||
    pr?.target_branch ||
    pr?.targetBranch ||
    pr?.base?.ref ||
    pr?.base?.name ||
    pr?.target?.branch ||
    ""
  );
}

function prSourceSha(pr, env) {
  return (
    env.CNB_PULL_REQUEST_SHA ||
    pr?.source_sha ||
    pr?.sourceSha ||
    pr?.head?.sha ||
    pr?.source?.sha ||
    env.CNB_COMMIT ||
    ""
  );
}

function prTargetSha(pr, env) {
  return (
    env.CNB_PULL_REQUEST_TARGET_SHA ||
    pr?.target_sha ||
    pr?.targetSha ||
    pr?.base?.sha ||
    pr?.target?.sha ||
    env.CNB_BEFORE_SHA ||
    ""
  );
}

function prWebUrl(client, prIid, pr, env) {
  if (pr?.web_url) return pr.web_url;
  if (pr?.html_url) return pr.html_url;
  const protocol = env.CNB_WEB_PROTOCOL || "https";
  const host = env.CNB_WEB_HOST || "cnb.woa.com";
  return `${protocol}://${host}/${client.repo}/-/pulls/${prIid}`;
}

function cleanTitle(title) {
  return title.replace(/^(🔴|🟡|🟢)\s+/u, "");
}

function nonStateLabels(labels) {
  return labels.filter((label) => !isIssueStateLabel(label));
}

function isOpenIssue(issue) {
  return issue?.state === "open" || issue?.state === "opened";
}

function sameLabelMultiset(left, right) {
  if (left.length !== right.length) return false;
  const counts = new Map();
  for (const label of left) {
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  for (const label of right) {
    const count = counts.get(label) || 0;
    if (count === 0) return false;
    if (count === 1) counts.delete(label);
    else counts.set(label, count - 1);
  }
  return counts.size === 0;
}

async function readVersionedIssue(client, issueIid) {
  if (typeof client.getIssueVersioned !== "function") {
    throw new Error(
      "Merged Issue sync requires versioned Issue reads; getIssueVersioned is unavailable",
    );
  }
  const snapshot = await client.getIssueVersioned(issueIid);
  if (
    !snapshot?.issue ||
    typeof snapshot.version !== "string" ||
    !snapshot.version.trim()
  ) {
    throw new Error(
      `Issue #${issueIid} versioned read returned no usable version token`,
    );
  }
  return snapshot;
}

function verifyFinalIssueSnapshot({
  issue,
  issueIid,
  acContractDigest,
  expectedNonStateLabels,
}) {
  if (!isOpenIssue(issue)) {
    throw new Error(
      `Issue #${issueIid} must remain open through final merge-state verification; current=${issue?.state || "unknown"}`,
    );
  }

  const labels = platformUtils.normalizeLabels(issue);
  const state = getIssueState(labels);
  if (state !== "待发布") {
    throw new Error(
      `Issue #${issueIid} final state must be 待发布; current=${state || "none"}`,
    );
  }

  const currentContract = canonicalizeIssueAcceptanceCriteria(
    readIssueBody(issue),
  );
  if (currentContract.digest !== acContractDigest) {
    throw new Error(
      `Issue #${issueIid} AC digest changed during merge sync: PR=${acContractDigest}, current=${currentContract.digest}`,
    );
  }

  const finalNonStateLabels = nonStateLabels(labels);
  if (!sameLabelMultiset(finalNonStateLabels, expectedNonStateLabels)) {
    throw new Error(
      `Issue #${issueIid} non-state labels changed during merge sync: expected=${JSON.stringify(expectedNonStateLabels)}, current=${JSON.stringify(finalNonStateLabels)}`,
    );
  }
}

async function upsertStandardComment({
  client,
  env,
  logger,
  pr,
  prIid,
  issueIid,
  acContractDigest,
}) {
  const body =
    `🔗 cmd-publish: PR #${prIid} 已合入\n\n` +
    `- PR: ${prWebUrl(client, prIid, pr, env)}\n` +
    `- 目标分支: ${prTargetBranch(pr, env) || "main"}\n` +
    `- 标题: ${cleanTitle(prTitle(pr, env))}\n` +
    `- AC-contract: ${acContractDigest}\n` +
    `- Target-label: 待发布\n\n` +
    `> 由 sync-issues-on-branch-merge.mjs 在 CNB pull_request.merged 阶段自动同步。`;

  const comments = await client.getIssueNotes(issueIid);
  const existing = comments.find((comment) => {
    const match = String(comment?.body || "").match(NOTE_PR_IID_PATTERN);
    return match && Number(match[1]) === Number(prIid);
  });

  if (existing) {
    const id = platformUtils.resolveCommentId(existing);
    if (id) {
      await client.updateIssueNote(issueIid, id, body);
      logger.log(`  Updated standard comment ${id}`);
      return;
    }
  }

  await client.createIssueNote(issueIid, body);
  logger.log("  Created standard comment");
}

async function advanceIssue({
  client,
  env,
  logger,
  pr,
  prIid,
  issueIid,
  acContractDigest,
}) {
  logSection(logger, `Sync Issue #${issueIid} -> 待发布`);

  const initialSnapshot = await readVersionedIssue(client, issueIid);
  const { issue } = initialSnapshot;
  const oldLabels = platformUtils.normalizeLabels(issue);
  const expectedNonStateLabels = nonStateLabels(oldLabels);
  const currentState = getIssueState(oldLabels);
  const currentContract = canonicalizeIssueAcceptanceCriteria(
    readIssueBody(issue),
  );
  if (currentContract.digest !== acContractDigest) {
    throw new Error(
      `Issue #${issueIid} AC digest changed before merge sync: PR=${acContractDigest}, current=${currentContract.digest}`,
    );
  }

  if (issue?.state === "closed") {
    if (currentState === "已发布") {
      logger.log(`  Issue #${issueIid} is already released and closed`);
      return { status: "already-released", issueIid };
    }
    throw new Error(
      `Issue #${issueIid} is closed in unexpected state ${currentState || "none"}`,
    );
  }
  if (!isOpenIssue(issue)) {
    throw new Error(
      `Issue #${issueIid} has unexpected lifecycle state ${issue?.state || "unknown"}`,
    );
  }

  logger.log(`  Current labels: ${oldLabels.join(", ") || "(none)"}`);

  if (currentState === "待发布") {
    const finalSnapshot = await readVersionedIssue(client, issueIid);
    verifyFinalIssueSnapshot({
      issue: finalSnapshot.issue,
      issueIid,
      acContractDigest,
      expectedNonStateLabels,
    });
    await upsertStandardComment({
      client,
      env,
      logger,
      pr,
      prIid,
      issueIid,
      acContractDigest,
    });
    return { status: "already-advanced", issueIid, targetLabel: "待发布" };
  }
  if (currentState !== "开发中") {
    throw new Error(
      `Issue #${issueIid} must be 开发中 before merge sync; current=${currentState || "none"}`,
    );
  }

  const transition = transitionIssueStateLabels(oldLabels, "待发布");

  if (!transition.allowed) {
    throw new Error(
      `Issue #${issueIid} cannot transition ${transition.currentState || "none"} -> 待发布`,
    );
  }

  if (typeof client.putIssueLabelsIfMatch !== "function") {
    throw new Error(
      "Merged Issue sync requires conditional label writes; putIssueLabelsIfMatch is unavailable",
    );
  }
  await client.putIssueLabelsIfMatch(
    issueIid,
    transition.labels,
    initialSnapshot.version,
  );
  logger.log(`  Labels updated: ${transition.labels.join(", ")}`);

  const finalSnapshot = await readVersionedIssue(client, issueIid);
  verifyFinalIssueSnapshot({
    issue: finalSnapshot.issue,
    issueIid,
    acContractDigest,
    expectedNonStateLabels,
  });

  await upsertStandardComment({
    client,
    env,
    logger,
    pr,
    prIid,
    issueIid,
    acContractDigest,
  });

  return { status: "advanced", issueIid, targetLabel: "待发布" };
}

export async function runMergedIssueSync({
  env = process.env,
  client,
  logger = console,
  changedPaths,
  git,
} = {}) {
  const prIid = resolvePrIid(env);
  if (!prIid) {
    throw new TargetLabelValidationError(
      "Missing CNB_PULL_REQUEST_IID in merged event",
    );
  }

  const eventSourceBranch = env.CNB_PULL_REQUEST_BRANCH || "";
  const eventTargetBranch = env.CNB_BRANCH || "";
  if (isPrototypeBranch(eventSourceBranch)) {
    throw new TargetLabelValidationError(
      `Prototype branch reached merged event: ${eventSourceBranch}`,
    );
  }
  if (eventTargetBranch && eventTargetBranch !== "main") {
    throw new TargetLabelValidationError(
      `Merged issue sync only accepts target main; received ${eventTargetBranch}`,
    );
  }

  const resolvedClient =
    client || createPlatformClient({ token: env.CNB_TOKEN || "" });
  logSection(logger, `Read PR #${prIid}`);
  const pr = await resolvedClient.getPR(prIid);
  const sourceBranch = prSourceBranch(pr, env);
  const targetBranch = prTargetBranch(pr, env);

  if (isPrototypeBranch(sourceBranch)) {
    throw new TargetLabelValidationError(
      `Prototype branch reached merged event: ${sourceBranch}`,
    );
  }
  if (!sourceBranch || targetBranch !== "main") {
    throw new TargetLabelValidationError(
      `Merged issue sync requires a source branch targeting main; received ${sourceBranch || "(unknown)"} -> ${targetBranch || "(unknown)"}`,
    );
  }

  const description = prBody(pr);
  const targetLabel = parseTargetLabel(description);
  const acContractDigest = parseAcContractDigest(description);
  const issueIid = parseSingleIssueRef(description, {
    required: targetLabel === "待发布",
  });
  const route = validatePrRouteContract({
    sourceBranch,
    targetLabel,
    issueIid,
    acContractDigest,
  });

  if (route.kind === "infrastructure") {
    const trustedChangedPaths =
      changedPaths ??
      resolvePullRequestChangedPaths({
        env,
        sourceBranch,
        targetBranch,
        headSha: prSourceSha(pr, env),
        targetSha: prTargetSha(pr, env),
        git,
      });
    assertInfrastructureChangedPaths(trustedChangedPaths);
    logger.log("Valid infrastructure merge: no Issue state transition");
    return { status: "skipped-infrastructure", targetLabel };
  }

  const result = await advanceIssue({
    client: resolvedClient,
    env,
    logger,
    pr,
    prIid,
    issueIid,
    acContractDigest,
  });
  logger.log("");
  logger.log("CNB merged issue sync done");
  return result;
}

function isDirectExecution() {
  return Boolean(
    process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url,
  );
}

if (isDirectExecution()) {
  runMergedIssueSync().catch((error) => {
    console.error("");
    console.error(
      "sync-issues-on-branch-merge crashed after merge; failing the pipeline for visibility",
    );
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
  });
}
