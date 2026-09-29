/**
 * stylelint-design-system — 设计系统守门人插件
 *
 * 规则清单：
 * 1. design-system/no-hardcoded-colors  — 禁止硬编码色值（hex + rgba）
 * 2. design-system/no-var-fallback      — 禁止 var(--token, #xxx) fallback
 * 3. design-system/no-legacy-tokens     — 禁止 shadcn 旧 token
 * 4. design-system/no-hardcoded-border-radius — 圆角必须使用 var(--radius-*) token
 * 5. design-system/no-hardcoded-box-shadow    — shadow 必须使用 var(--shadow-*) / var(--wb-shadow-*) token
 * 6. design-system/spacing-4px-multiple       — 间距必须是 4px 倍数
 */
const stylelint = require("stylelint");

const NAMESPACE = "design-system";

// ============================================================
// Rule 1: no-hardcoded-colors
// 检测 CSS 属性值中的裸 hex 色值和裸 rgba()/rgb() 色值
// 排除 var() 内的 fallback（那由 Rule 2 管）
// ============================================================

// 色彩相关属性（只对这些属性检测 rgba，避免误报 clip-path 等非色彩属性）
const COLOR_PROPS = new Set([
  "color",
  "background",
  "background-color",
  "border",
  "border-color",
  "border-top",
  "border-right",
  "border-bottom",
  "border-left",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
  "outline",
  "outline-color",
  "box-shadow",
  "text-shadow",
  "text-decoration-color",
  "fill",
  "stroke",
  "stop-color",
  "flood-color",
  "lighting-color",
  "column-rule-color",
  "caret-color",
  "accent-color",
]);

const noHardcodedColors = stylelint.createPlugin(
  `${NAMESPACE}/no-hardcoded-colors`,
  (primary) => {
    return (root, result) => {
      if (!primary) return;

      root.walkDecls((decl) => {
        const value = decl.value;
        if (!value) return;

        // 跳过 CSS 变量定义（--xxx: #色值 是定义层，允许）
        if (decl.prop.startsWith("--")) return;

        // 移除所有 var(...) 块后检查（嵌套 var 也要处理）
        const withoutVar = stripVar(value);

        // 检查裸 hex 色值
        const hexMatch = withoutVar.match(/#[0-9a-fA-F]{3,8}\b/);
        if (hexMatch) {
          stylelint.utils.report({
            message: `禁止硬编码色值 "${hexMatch[0]}"，请使用 var(--token) 语义 Token`,
            node: decl,
            result,
            ruleName: `${NAMESPACE}/no-hardcoded-colors`,
          });
          return;
        }

        // 检查裸 rgba()/rgb() — 仅对色彩相关属性
        if (isColorProp(decl.prop)) {
          const rgbaMatch = withoutVar.match(/rgba?\([^)]*\)/);
          if (rgbaMatch) {
            stylelint.utils.report({
              message: `禁止硬编码色值 "${rgbaMatch[0]}"，请使用 var(--token) 语义 Token`,
              node: decl,
              result,
              ruleName: `${NAMESPACE}/no-hardcoded-colors`,
            });
          }
        }
      });
    };
  },
);

// ============================================================
// Rule 2: no-var-fallback
// 检测 var(--token, #xxx) 或 var(--token, rgba(...)) 形式的 fallback
// ============================================================
const noVarFallback = stylelint.createPlugin(
  `${NAMESPACE}/no-var-fallback`,
  (primary) => {
    return (root, result) => {
      if (!primary) return;

      // 匹配 var(--xxx, #hex) 或 var(--xxx, rgba(...))
      const fallbackRe =
        /var\((--[^,)]+),\s*(?:#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))\)/;

      root.walkDecls((decl) => {
        const value = decl.value;
        if (!value) return;
        if (decl.prop.startsWith("--")) return;

        const match = value.match(fallbackRe);
        if (match) {
          stylelint.utils.report({
            message: `禁止 var fallback "${match[0]}"，请直接使用 var(${match[1]})`,
            node: decl,
            result,
            ruleName: `${NAMESPACE}/no-var-fallback`,
          });
        }
      });
    };
  },
);

// ============================================================
// Rule 3: no-legacy-tokens
// 检测 shadcn 旧 token：var(--foreground)、var(--card)、var(--muted) 等
// 排除合规的带后缀 token（如 --border-default、--border-strong）
// ============================================================
const LEGACY_TOKENS = [
  "foreground",
  "card",
  "muted",
  "secondary",
  "primary",
  "accent",
  "destructive",
  "border",
  "background",
  "popover",
  "input",
  "ring",
];

const noLegacyTokens = stylelint.createPlugin(
  `${NAMESPACE}/no-legacy-tokens`,
  (primary) => {
    return (root, result) => {
      if (!primary) return;

      // 构建精确匹配：var(--token) 或 var(--token, ...) 但不匹配 var(--token-xxx)
      const legacyRe = new RegExp(
        `var\\(--(${LEGACY_TOKENS.join("|")})(?:\\s*[,)]|\\))`,
      );

      root.walkDecls((decl) => {
        const value = decl.value;
        if (!value) return;
        if (decl.prop.startsWith("--")) return;

        const match = value.match(legacyRe);
        if (match) {
          stylelint.utils.report({
            message: `禁止使用 shadcn 旧 token "var(--${match[1]})"，请使用语义 Token`,
            node: decl,
            result,
            ruleName: `${NAMESPACE}/no-legacy-tokens`,
          });
        }
      });
    };
  },
);

// ============================================================
// Rule 4: no-hardcoded-border-radius
// 圆角必须使用 var(--radius-*) token，禁止硬编码 px/%
// 允许：0、50%、var(--radius-*)、9999px（胶囊形）
// ============================================================
const noHardcodedBorderRadius = stylelint.createPlugin(
  `${NAMESPACE}/no-hardcoded-border-radius`,
  (primary) => {
    return (root, result) => {
      if (!primary) return;

      const radiusProps = new Set([
        "border-radius",
        "border-top-left-radius",
        "border-top-right-radius",
        "border-bottom-left-radius",
        "border-bottom-right-radius",
      ]);

      root.walkDecls((decl) => {
        if (!radiusProps.has(decl.prop)) return;
        if (decl.prop.startsWith("--")) return;

        const value = decl.value.trim();

        // 允许 0
        if (value === "0") return;
        // 允许 inherit / initial / unset
        if (/^(inherit|initial|unset|revert)$/.test(value)) return;
        // 允许 50%（圆形头像）
        if (value === "50%") return;
        // 允许 9999px（胶囊形）
        if (value === "9999px") return;

        // 拆分简写值（border-radius 可以有 1~4 个值，还可能有 / 分隔）
        // 每个子值如果是 0、var(--xxx) 则允许；否则报错
        const parts = value.split(/[\s/]+/).filter(Boolean);
        const hasHardcoded = parts.some((part) => {
          if (part === "0") return false;
          if (/^var\(--/.test(part)) return false;
          return true;
        });

        if (!hasHardcoded) return;

        stylelint.utils.report({
          message: `禁止硬编码圆角 "${value}"，请使用 var(--radius-*-val) Token（如 var(--radius-md-val)）`,
          node: decl,
          result,
          ruleName: `${NAMESPACE}/no-hardcoded-border-radius`,
        });
      });
    };
  },
);

// ============================================================
// Rule 5: no-hardcoded-box-shadow
// shadow 必须使用 var(--shadow-*) 或 var(--wb-shadow-*) token，禁止硬编码
// 允许：none、var(--shadow-*)、var(--wb-shadow-*)、inset var(--shadow-*)
// ============================================================
const noHardcodedBoxShadow = stylelint.createPlugin(
  `${NAMESPACE}/no-hardcoded-box-shadow`,
  (primary) => {
    return (root, result) => {
      if (!primary) return;

      root.walkDecls((decl) => {
        if (decl.prop !== "box-shadow") return;
        if (decl.prop.startsWith("--")) return;

        const value = decl.value.trim();

        // 允许 none
        if (value === "none") return;
        // 允许纯 var(--shadow-*) / var(--wb-shadow-*) 引用（可能带 inset 前缀或逗号分隔多个 var）
        // --wb-shadow-* 是 globals.css 里的基础 shadow token（语义 --shadow-* 的转包层），
        // 按 tokens-usage 规则应优先使用，故一并放行
        if (/^(?:inset\s+)?var\(--(?:wb-)?shadow-/.test(value)) return;
        // 允许 inherit / initial / unset
        if (/^(inherit|initial|unset|revert)$/.test(value)) return;

        stylelint.utils.report({
          message: `禁止硬编码 box-shadow "${truncate(value, 60)}"，请使用 var(--shadow-1) ~ var(--shadow-4) 或 var(--wb-shadow-*) Token`,
          node: decl,
          result,
          ruleName: `${NAMESPACE}/no-hardcoded-box-shadow`,
        });
      });
    };
  },
);

// ============================================================
// Rule 6: spacing-4px-multiple
// 间距属性值中的 px 值必须是 4 的倍数
// 检测范围：margin / padding / gap / top / right / bottom / left / inset
// 豁免：0、1px（细线）、var() 引用、calc() 表达式、百分比、em/rem
// ============================================================

const SPACING_PROPS_RE =
  /^(margin|padding|gap|row-gap|column-gap|top|right|bottom|left|inset)(-top|-right|-bottom|-left|-inline|-block|-inline-start|-inline-end|-block-start|-block-end)?$/;

const spacing4pxMultiple = stylelint.createPlugin(
  `${NAMESPACE}/spacing-4px-multiple`,
  (primary) => {
    return (root, result) => {
      if (!primary) return;

      root.walkDecls((decl) => {
        if (!SPACING_PROPS_RE.test(decl.prop)) return;
        if (decl.prop.startsWith("--")) return;

        const value = decl.value.trim();
        // 跳过 var() / calc() / auto / inherit 等
        if (/var\(|calc\(|auto|inherit|initial|unset|revert/i.test(value))
          return;

        // 提取所有 px 值
        const pxValues = value.match(/-?[\d.]+px/g);
        if (!pxValues) return;

        for (const pxVal of pxValues) {
          const num = parseFloat(pxVal);
          // 豁免 0、1px（细线边距）、2px（微调间距）
          if (num === 0 || Math.abs(num) <= 2) continue;
          if (num % 4 !== 0) {
            stylelint.utils.report({
              message: `间距 "${pxVal}" 不是 4px 的倍数，请使用 4px 基数间距（如 ${nearest4(num)}px）`,
              node: decl,
              result,
              ruleName: `${NAMESPACE}/spacing-4px-multiple`,
            });
            break; // 每个声明只报一次
          }
        }
      });
    };
  },
);

// ============================================================
// Helpers
// ============================================================

/** 递归剥离 var(...) 块 */
function stripVar(str) {
  let prev;
  do {
    prev = str;
    str = str.replace(/var\([^()]*\)/g, "");
  } while (str !== prev);
  return str;
}

/** 判断是否为色彩相关属性 */
function isColorProp(prop) {
  if (COLOR_PROPS.has(prop)) return true;
  // 简写属性 border-xxx 也可能携带色值
  if (/^border/.test(prop) && /color/i.test(prop)) return true;
  return false;
}

/** 截断字符串 */
function truncate(str, max) {
  return str.length > max ? str.slice(0, max) + "…" : str;
}

/** 最接近的 4 的倍数 */
function nearest4(n) {
  return Math.round(n / 4) * 4;
}

module.exports = [
  noHardcodedColors,
  noVarFallback,
  noLegacyTokens,
  noHardcodedBorderRadius,
  noHardcodedBoxShadow,
  spacing4pxMultiple,
];
