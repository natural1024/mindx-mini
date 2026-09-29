/** @type {import('stylelint').Config} */
module.exports = {
  customSyntax: "postcss-less",
  plugins: ["./tools/stylelint-design-system/index.js"],
  rules: {
    // ===== 设计系统守门人规则 =====
    "design-system/no-hardcoded-colors": true,
    "design-system/no-var-fallback": true,
    "design-system/no-legacy-tokens": true,
    "design-system/no-hardcoded-border-radius": true,
    "design-system/no-hardcoded-box-shadow": true,
    "design-system/spacing-4px-multiple": true,

    // ===== 关闭与 Less 冲突的标准规则 =====
    "no-descending-specificity": null,
    "no-empty-source": null,
    "import-notation": null,
    "at-rule-no-unknown": null,
    "function-no-unknown": null,
    "media-query-no-invalid": null,
    "no-invalid-position-at-import-rule": null,
    "selector-class-pattern": null,
  },

  // ===== 豁免文件 =====
  ignoreFiles: [
    // Token 定义层（允许硬编码色值）
    "**/styles/globals.css",
    // 设计系统演示页（需要展示原始色值）
    "**/design-system-*/**",
    "**/design-system-page/**",
    // 构建产物
    "**/dist/**",
    "**/lib/**",
    "**/node_modules/**",
  ],
};
