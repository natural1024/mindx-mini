#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const IMAGE_REPOSITORY =
  "ai-copilot.tencentcloudcr.com/ai-copilot/library-frontend";
const RELEASE_TARGETS = {
  cn: {
    cdnRoot: "https://static.workbuddy.cn/web/library",
    imageRepository: IMAGE_REPOSITORY,
  },
  international: {
    cdnRoot: "https://download.codebuddy.ai/web/library",
    imageRepository: "codebuddy.tencentcloudcr.com/codebuddy/library-frontend",
  },
};

export function createReleaseVariables({
  commitDate,
  commitSha,
  release,
  region = "cn",
}) {
  if (!Object.hasOwn(RELEASE_TARGETS, region)) {
    throw new Error("region must be cn or international");
  }
  if (!/^[0-9a-f]{40}$/.test(commitSha)) {
    throw new Error(
      "commit SHA must contain exactly 40 lowercase hexadecimal characters",
    );
  }
  if (release && !/^\d{12}$/.test(commitDate ?? "")) {
    throw new Error("release commit date must contain exactly 12 digits");
  }

  const target = RELEASE_TARGETS[region];
  const assetBaseUrl = `${target.cdnRoot}/${commitSha}`;
  const imageVersionDate = release
    ? `${commitDate}-${commitSha}`
    : `pr-${commitSha}`;
  return {
    ASSET_RELEASE_ID: commitSha,
    CDN_RELEASE_URL: assetBaseUrl,
    IMAGE_REPOSITORY: target.imageRepository,
    IMAGE_TAG: `${imageVersionDate}-amd64`,
    IMAGE_VERSION_DATE: imageVersionDate,
    MINDX_FEDERATION_CDN_BASE_URL: `${assetBaseUrl}/js/federation`,
    MINDX_PUBLIC_ASSET_BASE_URL: assetBaseUrl,
  };
}

function parseCliArgs(argv) {
  const release = argv.includes("--release");
  const pr = argv.includes("--pr");
  const shaIndex = argv.indexOf("--sha");
  const regionIndex = argv.indexOf("--region");
  if (
    regionIndex !== -1 &&
    (!argv[regionIndex + 1] || argv[regionIndex + 1].startsWith("--"))
  ) {
    throw new Error("--region requires cn or international");
  }
  if (release === pr || shaIndex === -1 || !argv[shaIndex + 1]) {
    throw new Error(
      "usage: release-vars.mjs (--release|--pr) --sha <commit-sha> [--region cn|international]",
    );
  }
  return {
    commitSha: argv[shaIndex + 1],
    release,
    region: regionIndex === -1 ? "cn" : argv[regionIndex + 1],
  };
}

function readCommitDate(commitSha) {
  return execFileSync(
    "git",
    ["show", "-s", "--format=%cd", "--date=format:%Y%m%d%H%M", commitSha],
    { encoding: "utf8" },
  ).trim();
}

function main() {
  const { commitSha, release, region } = parseCliArgs(process.argv.slice(2));
  const variables = createReleaseVariables({
    commitDate: release ? readCommitDate(commitSha) : undefined,
    commitSha,
    release,
    region,
  });
  for (const [name, value] of Object.entries(variables)) {
    console.log(`${name}=${value}`);
    console.log(`##[set-output ${name}=${value}]`);
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
