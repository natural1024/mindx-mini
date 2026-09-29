const PLACEHOLDER_TITLE_PATTERN =
  /^(?:test|tmp|wip|fixup|squash|update|fix bug|fix typo|debug|临时|测试|调试)$/iu;

function titleCore(value) {
  return String(value || "")
    .trim()
    .replace(/\s+(?:#\d+|\[no-issue\])\s*$/iu, "")
    .trim();
}

export function isPlaceholderPrTitle(value) {
  const core = titleCore(value);
  return core.length === 0 || PLACEHOLDER_TITLE_PATTERN.test(core);
}

export function assertFinalPrTitle(value) {
  const title = String(value || "").trim();
  if (isPlaceholderPrTitle(title)) {
    throw new Error(
      "PR title must be final and meaningful before the first post-pull call; placeholder titles are forbidden",
    );
  }
  return title;
}
