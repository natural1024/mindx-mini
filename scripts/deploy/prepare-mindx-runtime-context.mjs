#!/usr/bin/env node

import { cp, mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

async function copyRequired(source, target, recursive = false) {
  const sourceStat = await stat(source).catch(() => null);
  if (!sourceStat)
    throw new Error(`required runtime artifact is missing: ${source}`);
  if (recursive && !sourceStat.isDirectory()) {
    throw new Error(`required runtime artifact must be a directory: ${source}`);
  }
  await mkdir(path.dirname(target), { recursive: true });
  await cp(source, target, { recursive });
}

async function walk(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(current, entry.name);
    const relative = path.relative(root, absolute).split(path.sep).join("/");
    if (entry.isDirectory()) files.push(...(await walk(root, absolute)));
    else files.push(relative);
  }
  return files;
}

export async function prepareRuntimeContext({
  dockerfileDir,
  targetDir,
  workspace = process.cwd(),
} = {}) {
  const contextDir =
    targetDir ?? path.join(workspace, ".release/mindx-runtime");
  const ciDir =
    dockerfileDir ?? path.join(workspace, "apps/mindx-webserver/ci");
  await rm(contextDir, { force: true, recursive: true });
  await mkdir(path.join(contextDir, "public"), { recursive: true });

  const copies = [
    [path.join(ciDir, "Dockerfile"), path.join(contextDir, "Dockerfile")],
    [path.join(ciDir, ".dockerignore"), path.join(contextDir, ".dockerignore")],
    [
      path.join(workspace, "apps/mindx-webserver/package.json"),
      path.join(contextDir, "package.json"),
    ],
    [
      path.join(workspace, "apps/mindx-webserver/package-lock.json"),
      path.join(contextDir, "package-lock.json"),
    ],
    [
      path.join(workspace, "apps/mindx/public/server-html/pc.html"),
      path.join(contextDir, "public/pc.html"),
    ],
    [
      path.join(workspace, "apps/mindx/public/server-html/mobile.html"),
      path.join(contextDir, "public/mobile.html"),
    ],
    [
      path.join(
        workspace,
        "apps/mindx/public/cdn/js/federation/federation-manifest.json",
      ),
      path.join(contextDir, "public/federation-manifest.json"),
    ],
  ];
  await Promise.all(
    copies.map(([source, target]) => copyRequired(source, target)),
  );
  await copyRequired(
    path.join(workspace, "apps/mindx-webserver/dist"),
    path.join(contextDir, "dist"),
    true,
  );

  const files = await walk(contextDir);
  const forbidden = files.filter(
    (file) =>
      file.split("/").includes("node_modules") ||
      file.split("/").includes(".git") ||
      /^public\/(?:js|css|image)\//.test(file) ||
      /(?:secret|credential)/i.test(file),
  );
  if (forbidden.length > 0) {
    throw new Error(
      `runtime context contains forbidden files:\n${forbidden.join("\n")}`,
    );
  }
  console.log(`Runtime context ready: ${contextDir} (${files.length} files)`);
  return contextDir;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  prepareRuntimeContext().catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  });
}
