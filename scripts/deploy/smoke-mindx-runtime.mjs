#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined) {
      throw new Error(`invalid argument near ${flag ?? "end of command"}`);
    }
    options[
      flag.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
    ] = value;
  }
  for (const name of ["image", "assetBaseUrl", "federationBaseUrl"]) {
    if (!options[name])
      throw new Error(
        `--${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)} is required`,
      );
  }
  return options;
}

function runDocker(args, options = {}) {
  return execFileSync("docker", args, {
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
  })?.trim();
}

function digest(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

const CONTAINER_FETCH_SCRIPT = `
const response = await fetch(new URL(process.argv[1], "http://127.0.0.1:3000"));
process.stdout.write(JSON.stringify({
  body: await response.text(),
  status: response.status,
}));
`;

export function createRuntimeProbeArgs(containerName, pathname) {
  if (!pathname.startsWith("/")) {
    throw new Error(`runtime probe path must start with /: ${pathname}`);
  }
  return [
    "exec",
    containerName,
    "node",
    "--input-type=module",
    "--eval",
    CONTAINER_FETCH_SCRIPT,
    pathname,
  ];
}

function fetchFromContainer(containerName, pathname) {
  const output = runDocker(createRuntimeProbeArgs(containerName, pathname), {
    capture: true,
  });
  return JSON.parse(output);
}

async function waitForHealth(containerName, attempts = 60) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = fetchFromContainer(containerName, "/status/health");
      if (response.status === 200) return;
      lastError = new Error(`health returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(
    `runtime health check timed out: ${lastError?.message ?? "unknown error"}`,
  );
}

async function assertContainerFiles(containerName, workspace) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "mindx-runtime-smoke-"));
  try {
    const comparisons = [
      ["pc.html", "apps/mindx/public/server-html/pc.html"],
      ["mobile.html", "apps/mindx/public/server-html/mobile.html"],
      [
        "federation-manifest.json",
        "apps/mindx/public/cdn/js/federation/federation-manifest.json",
      ],
    ];
    for (const [runtimeName, sourceName] of comparisons) {
      const copiedFile = path.join(tempDir, runtimeName);
      runDocker([
        "cp",
        `${containerName}:/app/public/${runtimeName}`,
        copiedFile,
      ]);
      const [runtimeContents, sourceContents] = await Promise.all([
        readFile(copiedFile),
        readFile(path.join(workspace, sourceName)),
      ]);
      if (digest(runtimeContents) !== digest(sourceContents)) {
        throw new Error(
          `container artifact differs from host build: ${runtimeName}`,
        );
      }
    }
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const workspace = path.resolve(options.workspace ?? process.cwd());
  const contextDir = path.join(workspace, ".release/mindx-runtime");
  const containerName = `mindx-runtime-smoke-${process.pid}-${Date.now()}`;

  runDocker([
    "build",
    "--platform",
    "linux/amd64",
    "--build-arg",
    `MINDX_PUBLIC_ASSET_BASE_URL=${options.assetBaseUrl}`,
    "--build-arg",
    `MINDX_FEDERATION_CDN_BASE_URL=${options.federationBaseUrl}`,
    "-t",
    options.image,
    contextDir,
  ]);

  try {
    runDocker(["run", "--detach", "--name", containerName, options.image]);
    await waitForHealth(containerName);

    const [manifestResponse, htmlResponse, missingAssetResponse] = [
      fetchFromContainer(containerName, "/space/federation/v1"),
      fetchFromContainer(containerName, "/space/home"),
      fetchFromContainer(containerName, "/js/missing.js"),
    ];
    if (manifestResponse.status < 200 || manifestResponse.status >= 300) {
      throw new Error(
        `manifest endpoint returned HTTP ${manifestResponse.status}`,
      );
    }
    if (
      htmlResponse.status < 200 ||
      htmlResponse.status >= 300 ||
      !htmlResponse.body.includes("<html")
    ) {
      throw new Error(
        `HTML endpoint returned an invalid response (${htmlResponse.status})`,
      );
    }
    if (missingAssetResponse.status !== 404) {
      throw new Error(
        `static extension fallback must return 404, got ${missingAssetResponse.status}`,
      );
    }
    const runtimeManifest = manifestResponse.body;
    const hostManifest = await readFile(
      path.join(
        workspace,
        "apps/mindx/public/cdn/js/federation/federation-manifest.json",
      ),
      "utf8",
    );
    if (digest(runtimeManifest) !== digest(hostManifest)) {
      throw new Error("manifest endpoint differs from the host build artifact");
    }
    const manifest = JSON.parse(runtimeManifest);
    if (
      manifest.remote?.entry !==
      `${options.federationBaseUrl}/releases/${manifest.releaseId}/remoteEntry.${manifest.releaseId}.js`
    ) {
      throw new Error(
        "runtime manifest entry does not match its releaseId and CDN base",
      );
    }
    await assertContainerFiles(containerName, workspace);
    console.log(
      `Runtime image verified: image=${options.image} releaseId=${manifest.releaseId}`,
    );
  } catch (error) {
    const logs = spawnSync("docker", ["logs", containerName], {
      encoding: "utf8",
    });
    if (logs.stdout) console.error(logs.stdout);
    if (logs.stderr) console.error(logs.stderr);
    throw error;
  } finally {
    spawnSync("docker", ["rm", "--force", containerName], { stdio: "inherit" });
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  });
}
