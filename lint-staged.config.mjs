// @ts-check
import { lstatSync } from "node:fs";

const IGNORED_STAGED_PREFIXES = [];

/**
 * 过滤掉符号链接：prettier / eslint / stylelint 都会拒绝处理 symlink
 * （prettier 直接报 "Explicitly specified pattern ... is a symbolic link"）。
 * 仓库根目录有 CLAUDE.md / CODEBUDDY.md 等软链到 AGENTS.md，
 * 不过滤会导致这类文件被 staged 时 pre-commit 必失败。已 staged 但仍命中
 * .gitignore 的文件也要跳过，否则 lint-staged 自动 git add 时会被 Git 拒绝。
 */
function filterRealFiles(files) {
  return files.filter((file) => {
    try {
      const normalized = file.replace(`${process.cwd()}/`, "");
      return (
        !lstatSync(file).isSymbolicLink() &&
        !IGNORED_STAGED_PREFIXES.some((prefix) => normalized.startsWith(prefix))
      );
    } catch {
      return false;
    }
  });
}

const COMMAND_CHUNK_SIZE = 40;

function quoteFiles(files) {
  return files.map((f) => `"${f}"`).join(" ");
}

function chunkFiles(files, size = COMMAND_CHUNK_SIZE) {
  const chunks = [];
  for (let index = 0; index < files.length; index += size) {
    chunks.push(files.slice(index, index + size));
  }
  return chunks;
}

function buildChunkedCommands(files, commandFactories) {
  return chunkFiles(files).flatMap((chunk) => {
    const list = quoteFiles(chunk);
    return commandFactories.map((createCommand) => createCommand(list));
  });
}

export default {
  "*.{ts,tsx,js,jsx,mjs,cjs}": (files) => {
    const real = filterRealFiles(files);
    if (real.length === 0) return [];
    return buildChunkedCommands(real, [
      (list) => `eslint --fix --no-warn-ignored ${list}`,
      (list) => `prettier --write --ignore-unknown ${list}`,
    ]);
  },
  "*.less": (files) => {
    const real = filterRealFiles(files);
    if (real.length === 0) return [];
    return buildChunkedCommands(real, [
      (list) => `stylelint --fix ${list}`,
      (list) => `prettier --write --ignore-unknown ${list}`,
    ]);
  },
  "*.{json,md,css,html,yml,yaml}": (files) => {
    const real = filterRealFiles(files);
    if (real.length === 0) return [];
    return buildChunkedCommands(real, [
      (list) => `prettier --write --ignore-unknown ${list}`,
    ]);
  },
};
