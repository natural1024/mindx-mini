import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

import { createReleaseVariables } from "./release-vars.mjs";

const SHA = "0123456789abcdef0123456789abcdef01234567";

test("creates immutable release URLs and the Genie-compatible amd64 tag", () => {
  assert.deepEqual(
    createReleaseVariables({
      commitDate: "202609032310",
      commitSha: SHA,
      release: true,
    }),
    {
      ASSET_RELEASE_ID: SHA,
      CDN_RELEASE_URL: `https://static.workbuddy.cn/web/library/${SHA}`,
      IMAGE_REPOSITORY:
        "ai-copilot.tencentcloudcr.com/ai-copilot/library-frontend",
      IMAGE_TAG: `202609032310-${SHA}-amd64`,
      IMAGE_VERSION_DATE: `202609032310-${SHA}`,
      MINDX_FEDERATION_CDN_BASE_URL: `https://static.workbuddy.cn/web/library/${SHA}/js/federation`,
      MINDX_PUBLIC_ASSET_BASE_URL: `https://static.workbuddy.cn/web/library/${SHA}`,
    },
  );
});

test("creates a local-only PR image tag without inventing a release date", () => {
  const variables = createReleaseVariables({ commitSha: SHA, release: false });

  assert.equal(variables.IMAGE_VERSION_DATE, `pr-${SHA}`);
  assert.equal(variables.IMAGE_TAG, `pr-${SHA}-amd64`);
});

test("builds international assets and images under the same immutable version", () => {
  const input = { commitDate: "202609032310", commitSha: SHA, release: true };
  const domestic = createReleaseVariables(input);
  const international = createReleaseVariables({
    ...input,
    region: "international",
  });

  assert.equal(international.IMAGE_TAG, domestic.IMAGE_TAG);
  assert.equal(international.IMAGE_VERSION_DATE, domestic.IMAGE_VERSION_DATE);
  assert.equal(international.ASSET_RELEASE_ID, domestic.ASSET_RELEASE_ID);
  assert.equal(
    international.IMAGE_REPOSITORY,
    "codebuddy.tencentcloudcr.com/codebuddy/library-frontend",
  );
  assert.equal(
    international.CDN_RELEASE_URL,
    `https://download.codebuddy.ai/web/library/${SHA}`,
  );
  assert.equal(
    international.MINDX_PUBLIC_ASSET_BASE_URL,
    international.CDN_RELEASE_URL,
  );
  assert.equal(
    international.MINDX_FEDERATION_CDN_BASE_URL,
    `${international.CDN_RELEASE_URL}/js/federation`,
  );
});

test("CLI selects the international build and rejects missing or unknown regions", () => {
  const args = [
    "scripts/deploy/release-vars.mjs",
    "--pr",
    "--sha",
    SHA,
    "--region",
  ];
  const output = execFileSync(process.execPath, [...args, "international"], {
    encoding: "utf8",
  });
  assert.match(
    output,
    /IMAGE_REPOSITORY=codebuddy\.tencentcloudcr\.com\/codebuddy\/library-frontend/,
  );
  for (const invalid of [[], ["unknown"]]) {
    assert.throws(() =>
      execFileSync(process.execPath, [...args, ...invalid], { stdio: "pipe" }),
    );
  }
  assert.throws(
    () =>
      createReleaseVariables({
        commitSha: SHA,
        release: false,
        region: "unknown",
      }),
    /region/,
  );
});

test("rejects unsafe commit identities and malformed commit dates", () => {
  assert.throws(
    () => createReleaseVariables({ commitSha: "main", release: false }),
    /40 lowercase hexadecimal/,
  );
  assert.throws(
    () =>
      createReleaseVariables({
        commitDate: "2026-09-03",
        commitSha: SHA,
        release: true,
      }),
    /12 digits/,
  );
});
