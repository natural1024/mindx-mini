/**
 * Commitlint 配置 —— 与项目「需求开发 & 发布流程规范」对齐
 * 详细规范见 docs/release-workflow.md
 *
 * 强制约束（v2 · 2026-06-04）：
 * 1. type 必须为 conventional commit 类型（feat/fix/chore/...）
 * 2. subject 末尾必须以 #<issueid> 或 [no-issue] 结尾（自定义规则 subject-must-end-with-issue-ref）
 *
 * CNB issue 真实性校验由 `.husky/commit-msg` 中追加的 `scripts/workflow/check-commit-issue-ref.mjs` 完成
 * （commitlint 本身不调外部 API，避免 commit 阻塞在网络故障上）。
 */

/**
 * 自定义规则：subject 末尾必须以 #<issueid> 或 [no-issue] 结尾
 *
 * 校验正则：/(#[1-9]\d*|\[no-issue\])$/
 *   - #\d+ 中要求第一位 ≥ 1，且不允许全 0；防止用 #0 / #000 等无效占位
 *
 * ✅ 合法示例：
 *   feat: profile onboarding 区分新老用户 #117
 *   fix: 修复 profile 页面打开异常 #117
 *   chore: 升级 smart-doc 系列 [no-issue]
 *
 * ❌ 不合法示例：
 *   feat: 新页面（既无 #id 也无 [no-issue]）
 *   feat: #117 新页面（#117 不在末尾）
 *   feat: 新页面 #000（已废弃 #000 占位用法）
 *   feat: 新页面 #0（无效占位）
 */
const subjectMustEndWithIssueRef = {
  "subject-must-end-with-issue-ref": (parsed) => {
    const subject = parsed.subject || "";
    const trimmed = subject.trim();
    const ok = /(#[1-9]\d*|\[no-issue\])$/.test(trimmed);
    return [
      ok,
      `commit subject 末尾必须以 #<issueid> 或 [no-issue] 结尾（实际：「${subject}」）\n` +
        `提示：#0 / #000 已废弃，无 issue 时请用 [no-issue]\n` +
        `详见 docs/release-workflow.md §1`,
    ];
  },
};

module.exports = {
  extends: ["@commitlint/config-conventional"],
  plugins: [
    {
      rules: subjectMustEndWithIssueRef,
    },
  ],
  rules: {
    // 允许的 type（与 SOP 中 Issue 标题规范一致，并适度扩展常见类型）
    "type-enum": [
      2,
      "always",
      [
        "feat", // 新功能
        "fix", // bug 修复
        "chore", // 构建 / 脚手架 / 依赖等杂项
        "docs", // 文档
        "style", // 代码格式（不影响逻辑）
        "refactor", // 重构（非功能、非修复）
        "perf", // 性能优化
        "test", // 测试
        "build", // 构建系统 / 外部依赖
        "ci", // CI 配置
        "revert", // 回滚
      ],
    ],
    // subject 不能为空 / 不要句号结尾
    "subject-empty": [2, "never"],
    "subject-full-stop": [2, "never", "."],
    // header 不要超过 100 字符（兼容中文 subject）
    "header-max-length": [2, "always", 100],
    // type 必须小写
    "type-case": [2, "always", "lower-case"],
    // subject 大小写不限制（中文场景）
    "subject-case": [0],
    // ✨ 自定义：subject 末尾必须以 #<issueid> 或 [no-issue] 结尾
    "subject-must-end-with-issue-ref": [2, "always"],
  },
};
