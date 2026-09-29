---
name: smart-doc-local
description: |
  在 mindx 与本地 smart-doc-editor / smart-engine / smart-page 三个外部仓之间
  建立源码级（或本地产物级）联调通道，让你在 mindx 调试时能够直接进入这些底层
  包的代码，断点 / HMR 即时生效。三个仓相互独立，可分别开关，也可同时开。

  - smart-doc-editor 联调（覆盖 mindx 依赖的所有 `@tencent/smart-doc-*` 包）：
    动态扫描 editor monorepo 的 `packages/` 与 `plugins/` 子目录，凡 npm 包名
    以 `@tencent/smart-doc-` 开头且 mindx 实际声明的，全部通过 `pnpm.overrides`
    link 到本地仓对应子目录，配合 rspack `conditionNames` 的 `'source'` 条件
    命中 package.json 的 source 入口。
  - smart-engine 联调（覆盖单包 @tencent/smart-engine）：通过 rspack
    `resolve.alias` 把包名直接重定向到本地仓的 src/index.ts。
  - smart-page / docs-ai-page 联调（覆盖
    `@tencent/docs-ai-page-visual-editor`）：通过 rspack `resolve.alias` 6 个
    精确别名把包根与全部子入口指向本地仓 **编译产物** `dist/index.esm.js`，
    不安装、不改 lockfile，纯 resolve 层重定向。

  本 skill 提供四个动作：启用 / 禁用 / 状态查询 / 重置。三个仓的路径分别保存到
  `.smart-doc-editor-local` / `.smart-engine-local` / `.docs-ai-page-local`
  （都已加入 `.gitignore`）。

  触发关键词：
    - "联调编辑器源码"、"调编辑器源码"、"联调 smart-doc"、"调 smart-doc 源码"
    - "联调 smart-engine"、"调 smart-engine 源码"、"调引擎源码"
    - "联调 smart-page"、"调 smart-page"、"联调 docs-ai-page"、"调 visual-editor"、
      "联调 AI 页面"、"调 AiEditPanel / FloatingToolbar"
    - "切回 npm 包"、"关掉编辑器联调"、"取消调试"、"恢复 smart-doc 包"、
      "关闭 docs-ai-page 本地联调"
    - "/smart-doc-local"、"smart-doc 联调状态"
triggers:
  - 用户想直接调试 @tencent/smart-doc-editor 及相关 smart-doc-* 插件包的源码
  - 用户想直接调试 @tencent/smart-engine 的源码
  - 用户想直接调试 smart-page 仓的 @tencent/docs-ai-page-visual-editor（AI 页面 / 可视化编辑器）
  - 用户想在改完编辑器、引擎或 smart-page 源码后立刻看到 mindx 里的效果（不想走 npm publish + bump）
  - 用户想从本地源码联调态切回 npm 包态（验证发布版行为 / 排查"是否本地改动副作用"）
  - 用户问当前是否处于本地联调态、链接路径是什么
---

## 涉及的三个仓 / 动态包发现

| 来源仓                      | npm 包名前缀                          | 仓内位置                                           | 联调机制                                                     |
| :-------------------------- | :------------------------------------ | :------------------------------------------------- | :----------------------------------------------------------- |
| smart-doc-editor (monorepo) | `@tencent/smart-doc-*`                | `packages/*` + `plugins/*`                         | `pnpm.overrides` 走 link + rspack `conditionNames: 'source'` |
| smart-engine (单包)         | `@tencent/smart-engine`               | 仓根 → `src/index.ts`                              | rspack `resolve.alias` 直接指 src                            |
| smart-page (monorepo)       | `@tencent/docs-ai-page-visual-editor` | `packages/ai-page/visual-editor/dist/index.esm.js` | rspack `resolve.alias` 6 个精确别名指**编译产物**            |

> **editor 侧采用动态发现，不维护包清单**：启用时扫描 editor monorepo 的
> `packages/` 与 `plugins/` 子目录，取所有 npm 包名以 `@tencent/smart-doc-`
> 开头的子包，与 mindx 实际声明的依赖（根 `package.json` + 各 app
> `package.json` 中的 `@tencent/smart-doc-*` 条目）取交集，仅对交集内的包
> 写 `link:` overrides。这样 editor 仓新增 plugin / 子包时无需同步改本 skill，
> 也避免把 mindx 不用的包强行 link 进来引入冲突。

> editor 仓所有 `@tencent/smart-doc-*` 包的 `package.json.exports` 已声明
> `"source": "./src/index.ts"`，走 conditionNames 路径；smart-engine 没有
> exports 字段，必须走 alias 路径；smart-page 的 visual-editor 走 alias 指
> dist（理由见"docs-ai-page 联调"章）。实现都在
> `tools/build-config/rspack/plugins/smart-doc-editor-local.ts` 一个文件内，
> 三个 plugin 函数（`applySmartDocEditorLocalDevtools` /
> `applySmartEngineLocalDevtools` / `applyDocsAiPageLocalDevtools`）互相独立，
> 由 createAppConfig 末尾依次调用。

## 路径配置文件

| 文件                      | 内容                                                | 是否入库        |
| :------------------------ | :-------------------------------------------------- | :-------------- |
| `.smart-doc-editor-local` | smart-doc-editor 仓的绝对路径（仓根，不带尾随 `/`） | ❌ 已 gitignore |
| `.smart-engine-local`     | smart-engine 仓的绝对路径（仓根，不带尾随 `/`）     | ❌ 已 gitignore |
| `.docs-ai-page-local`     | smart-page 仓的绝对路径（仓根，不带尾随 `/`）       | ❌ 已 gitignore |

校验：

- `.smart-doc-editor-local` 路径下需含 `packages/editor/package.json`（editor monorepo 的核心包，作为仓根定位锚点）
- `.smart-engine-local` 路径下需含 `src/index.ts`
- `.docs-ai-page-local` 路径下需含 `packages/ai-page/visual-editor/dist/index.esm.js`（**必须先在 smart-page 侧 build 过**）
- 任一不满足时该 plugin 视为未启用，原样透传 config

## 动作流程

### 动作 1：启用本地联调

启用是**三个独立开关**——editor / smart-engine / smart-page 各自决定。
smart-page 的流程与前两者差异较大（消费 dist、不需要 pnpm install），详见后文
「docs-ai-page（smart-page）联调」专章。

#### 1.1 询问启用范围

用 `AskUserQuestion` 问一个问题：用户想启用哪个 / 哪些联调。

```
question: 想启用哪些本地联调？（三者独立，可多选）
options:
  - 同时启用 editor + smart-engine（推荐，编辑器调试通常会用到 engine）
  - 仅启用 editor（所有 @tencent/smart-doc-* 包）
  - 仅启用 smart-engine
  - 仅启用 smart-page（@tencent/docs-ai-page-visual-editor，走 dist）
```

> 当前会话上下文中，如果用户已经隐含表达过偏好（如"再加上 smart-engine"、"调一下 smart-page 的 AiEditPanel"），可以直接进入对应分支不再问。

#### 1.2 收集路径

对启用的每个仓：

1. 读对应的 `.smart-doc-editor-local` / `.smart-engine-local`：
   - 文件存在 → 取首行作为路径，跳到 1.3 校验
   - 文件不存在 → 用 `AskUserQuestion` 询问该仓的绝对路径，用 `Write` 工具保存
2. **smart-engine 默认路径建议**：用户常把它放在 `../smart-engine`（与 mindx 同级）。可在 AskUserQuestion 选项中预填该路径作为推荐项。

#### 1.3 校验

```bash
# editor：校验仓根定位锚点（packages/editor 必须存在）
test -f <editor-path>/packages/editor/package.json
# smart-engine
test -f <engine-path>/src/index.ts && \
test -f <engine-path>/package.json
```

任一不满足报错并提示用户检查路径。

**版本兼容性提示**（仅对 editor 严重时阻断；engine 漂移容忍度高，提示即可）：

```bash
# editor
grep "smart-doc-editor" pnpm-workspace.yaml | awk -F: '{print $2}' | tr -d ' "^'
node -p "require('<editor-path>/packages/editor/package.json').version"
# engine
grep "smart-engine" pnpm-workspace.yaml | awk -F: '{print $2}' | tr -d ' "^'
node -p "require('<engine-path>/package.json').version"
```

major 不一致或 minor 跨度 ≥ 5 时提示用户确认是否继续。

#### 1.4 动态发现 + 写入 overrides

**editor 启用时**，先扫描 editor monorepo 发现所有 `@tencent/smart-doc-*` 包，再与 mindx 实际声明的依赖取交集，仅对交集内的包写 `link:` overrides：

```bash
# 单步发现脚本（Node）：输出需 link 的 {包名: 子目录相对路径} 映射
node -e "
const fs = require('fs');
const path = require('path');
const editorRoot = '<editor-path>';
const mindxRoot = process.cwd();

// 1. 扫描 editor 仓，收集所有 @tencent/smart-doc-* 包及其子目录相对路径
const editorPkgs = {};
for (const sub of ['packages', 'plugins']) {
  const dir = path.join(editorRoot, sub);
  if (!fs.existsSync(dir)) continue;
  for (const name of fs.readdirSync(dir)) {
    const pj = path.join(dir, name, 'package.json');
    if (!fs.existsSync(pj)) continue;
    const pkg = require(pj);
    if (pkg.name && pkg.name.startsWith('@tencent/smart-doc-')) {
      editorPkgs[pkg.name] = sub + '/' + name;
    }
  }
}

// 2. 扫描 mindx 根 + 各 app 的 package.json，收集实际声明的 @tencent/smart-doc-* 依赖
const declared = new Set();
const pjFiles = [
  path.join(mindxRoot, 'package.json'),
  ...fs.readdirSync(path.join(mindxRoot, 'apps')).map(a => path.join(mindxRoot, 'apps', a, 'package.json')),
  ...fs.readdirSync(path.join(mindxRoot, 'packages')).map(p => path.join(mindxRoot, 'packages', p, 'package.json')),
];
for (const f of pjFiles) {
  if (!fs.existsSync(f)) continue;
  const p = require(f);
  for (const dep of Object.keys({ ...(p.dependencies||{}), ...(p.devDependencies||{}) })) {
    if (dep.startsWith('@tencent/smart-doc-')) declared.add(dep);
  }
}

// 3. 取交集输出
for (const name of Object.keys(editorPkgs).sort()) {
  if (declared.has(name)) {
    console.log(name + ' -> ' + editorPkgs[name]);
  }
}
"
```

拿到交集后，在 mindx 根 `package.json` 的 `pnpm.overrides` 中为每个交集包写入：

```jsonc
"<包名>": "link:<editor-path>/<subpath>"
```

例如：

```jsonc
"@tencent/smart-doc-editor": "link:<editor-path>/packages/editor",
"@tencent/smart-doc-convert": "link:<editor-path>/packages/convert",
"@tencent/smart-doc-ui": "link:<editor-path>/packages/ui",
"@tencent/smart-doc-plugin-comment": "link:<editor-path>/plugins/comment",
"@tencent/smart-doc-plugin-mention": "link:<editor-path>/plugins/mention",
"@tencent/smart-doc-plugin-collab-cursor": "link:<editor-path>/plugins/collab-cursor"
// ... 交集内所有包，不写死清单
```

**smart-engine 启用时追加**：

```jsonc
"@tencent/smart-engine": "link:<engine-path>"
```

> 注意：mindx 根 `package.json.pnpm.overrides` 通常预存
> `@tencent/smart-engine: "catalog:"` 与若干 `@tencent/smart-doc-*: "catalog:"`
> 作为传递依赖锁定。启用 link 联调时，把这些条目**替换**为 `link:` 协议；
> 禁用时**还原回** `"catalog:"` 而非删除。启/停的状态机如下：
>
> | 状态           | `@tencent/smart-doc-*` 值 | `@tencent/smart-engine` 值 |
> | :------------- | :------------------------ | :------------------------- |
> | 主干（npm 态） | `"catalog:"`              | `"catalog:"`               |
> | 仅启用 editor  | `"link:..."`              | `"catalog:"`               |
> | 仅启用 engine  | `"catalog:"`              | `"link:..."`               |
> | 同时启用       | `"link:..."`              | `"link:..."`               |
>
> 对于 mindx 根 `package.json` overrides 中**原本没有**的 `@tencent/smart-doc-*`
> 包（如某些 plugin），启用时新增 `link:` 条目，禁用时彻底删除即可。

> ⚠️ 用 `link:` 协议而非 `file:`：`file:` 会复制目录到 `node_modules`，源码改动不会实时生效；`link:` 是 symlink，源码改动 rspack 立即可见。
>
> ⚠️ `link:` 路径用**绝对路径**，避免使用者切换 cwd 时出问题。

#### 1.5 安装

```bash
CODEBUDDY_SAFE_DELETE_ENABLED=0 pnpm install --no-frozen-lockfile
```

> `CODEBUDDY_SAFE_DELETE_ENABLED=0` 用于绕过 CodeBuddy IDE 注入的
> `node-safe-delete` 批量删除保护：link 切换会触发 pnpm 重排 node_modules、
> 一次性删除文件数达到阈值（500）时报
> `[safe-delete][SAFE_DELETE_BULK_CONFIRM_REQUIRED]` 而中断安装。非 CodeBuddy
> 环境没有这个 shim，可不加。

#### 1.5.1 link 后 patch 悬空（`ERR_PNPM_PATCH_NOT_APPLIED`）

`link:` 协议下 pnpm **不解析被 link 包的 dependencies**（link 目录被当作"已
自备 node_modules 的完成包"）。因此，仅由某个被 link 的 `@tencent/smart-doc-*`
包间接引入的依赖会从 mindx 依赖图 / lockfile 消失。若 `patchedDependencies`
里恰好有这种包，`pnpm install` 会报：

```text
ERR_PNPM_PATCH_NOT_APPLIED  The following patches were not applied: <pkg>@<version>
```

**当前已知命中**：`mdast-util-gfm-autolink-literal@2.0.1`（仅由
`@tencent/smart-doc-convert → remark-gfm → mdast-util-gfm` 链路引入，link
convert 后从依赖图消失）。

处置（link 期间临时移除，off 时恢复）：

1. 从根 `package.json` 的 `pnpm.patchedDependencies` 移除报错条目；
2. 正常跑 `pnpm install`；
3. 禁用（动作 2）时把该条目原样写回。

> 运行时不受影响：该包由 editor 仓自己的 `node_modules` 提供，且 editor 仓
> 打的是同一份 patch（patch_hash 一致），功能等价。

#### 1.6 校验链接成功

对交集内的每个包，在使用方 app 视角校验 src 直链可见（pnpm 严格模式下软链落在使用方的 node_modules，不在仓根；未直接依赖该包的 app 下不会有软链，属正常）：

```bash
# 示例：校验 editor 与一个 plugin
test -f apps/mindx/node_modules/@tencent/smart-doc-editor/src/index.ts && echo "editor src OK"
# 通用校验：遍历交集包，任一在 mindx app 下能看到 src 即算 link 生效
node -e "
const fs = require('fs');
const path = require('path');
const overrides = require('./package.json').pnpm.overrides;
for (const [name, val] of Object.entries(overrides)) {
  if (!String(val).startsWith('link:')) continue;
  // 在 MindX app 的 node_modules 下可见即算 link 生效
  const p = path.join(process.cwd(), 'apps/mindx/node_modules', name, 'src', 'index.ts');
  console.log(name + ': ' + (fs.existsSync(p) ? 'OK' : '(not directly depended by MindX)'));
}
"
# engine 链接情况
test -f apps/mindx/node_modules/@tencent/smart-engine/src/index.ts && echo "engine src OK"
```

通过后告知用户：

- 已链接到本地源码（含路径）
- 本次 link 的包清单（从 overrides 中提取所有 `link:` 条目）
- 启动 dev：`pnpm dev`，HMR + sourcemap 即时生效
- 想切回 npm 包：让用户说"切回 npm 包"或 `/smart-doc-local off`
- **硬提醒**："本次启用后，commit / push 之前请先 `/smart-doc-local off` 切回 npm 包，避免把 link: 协议推到远程"

### 动作 2：禁用本地联调（切回 npm 包）

读取 mindx 根 `package.json` 的当前 `pnpm.overrides`，按以下规则改写：

| key 匹配模式                                                | 当前值     | 处置                                            |
| :---------------------------------------------------------- | :--------- | :---------------------------------------------- |
| 所有 `@tencent/smart-doc-*` 开头的 key                      | `link:...` | **改回** `"catalog:"`（主干预存项保留，不删除） |
| `@tencent/smart-doc-*` 开头的 key（overrides 中原本没有的） | `link:...` | 删除（主干无此条目，禁用时清掉）                |
| `@tencent/smart-engine`                                     | `link:...` | **改回** `"catalog:"`（不删除——主干预存项）     |

> 判定逻辑：对 overrides 中每个值以 `link:` 开头的条目，按包名前缀分类处理。
> `@tencent/smart-doc-*` 前缀的 → 该 key 若在主干（origin/main）overrides
> 中存在则改回 `"catalog:"`，否则删除。简单做法：先全部改回 `"catalog:"`，
> 再与主干版本 diff，多出来的 `link:` 残留条目删掉。
>
> **只处理 `link:` 协议的条目**——已经是 `"catalog:"` 的不动。这样执行"取消调试"是幂等的，不会破坏未启用的那一边。

如果某条不在 overrides 里则跳过。

接着，**恢复 1.5.1 中临时移除的 patch 条目**（若当时移除过，如
`mdast-util-gfm-autolink-literal@2.0.1`），并重装：

```bash
CODEBUDDY_SAFE_DELETE_ENABLED=0 pnpm install --no-frozen-lockfile
```

校验：

```bash
ls -la apps/mindx/node_modules/@tencent/smart-doc-editor 2>/dev/null
ls -la apps/mindx/node_modules/@tencent/smart-engine 2>/dev/null
# 期望：软链到 .pnpm/<pkg>@<version>_<hash>/...，不再含本地仓路径
```

**保留** `.smart-doc-editor-local` / `.smart-engine-local` 文件不动，下次启用时直接复用。

最后比对当前 `package.json` 与 `pnpm-lock.yaml` 是否完全等同 origin/main：

```bash
git diff package.json | head
git diff pnpm-lock.yaml | grep -c "smartcanvas-editor\|smart-engine.*link"
```

任何脏 diff 提示用户审视后再 commit。

### 动作 3：状态查询

```bash
echo "[路径配置]"
test -f .smart-doc-editor-local && echo "editor: $(cat .smart-doc-editor-local)" || echo "editor: (未配置)"
test -f .smart-engine-local && echo "engine: $(cat .smart-engine-local)" || echo "engine: (未配置)"

echo
echo "[overrides 段]"
node -e "const p=require('./package.json').pnpm; console.log(p?.overrides ? JSON.stringify(p.overrides, null, 2) : '(空)')"

echo
echo "[实际链接态]"
ls -la apps/mindx/node_modules/@tencent/smart-doc-editor 2>/dev/null | head -1
ls -la apps/mindx/node_modules/@tencent/smart-engine 2>/dev/null | head -1
```

整理为 3 行输出向用户汇报：路径配置 / overrides 状态 / 实际链接状态是否一致。

### 动作 4：重置（极少用到）

「重置」= 禁用 + 清空 `.smart-doc-editor-local` / `.smart-engine-local` / `.docs-ai-page-local` 三个文件。仅当用户明确说"忘了之前路径，重新配"时才用。

## docs-ai-page（smart-page）联调 · 专章

> 已在本地验证生效（mindx `feature/1554-ai-edit-shortcut` 分支，
> smart-page `packages/ai-page/visual-editor` 本地 dist）。与前两个仓形态差异
> 较大，单独成章，不要拿 editor 那套流程套用。

### 覆盖范围

| 包                                    | 处置                                                                                                             |
| :------------------------------------ | :--------------------------------------------------------------------------------------------------------------- |
| `@tencent/docs-ai-page-visual-editor` | ✅ alias 到本地 dist（联调主体）                                                                                 |
| `@tencent/docs-ai-page-host`          | ❌ 仍用 registry 版本（其 dist 里 external 了 visual-editor，import 会被 alias 命中，因此改 visual-editor 即可） |
| `@tencent/docs-ai-page-database`      | ❌ 仍用 registry 版本                                                                                            |

### 核心差异（4 点）

1. **消费 dist 而非 src**。visual-editor 的 src 是多子入口 + CSS 变量注入 +
   workspace 依赖（`@tencent/docs-ai-page-sandbox`）的形态，直链 src 需要在
   mindx 侧复刻一整套 alias/loader，成本远高于让 smart-page 侧自己 build。
   所以约定：**smart-page 侧 build 出单文件 dist，mindx 侧只 alias 这一个文件**。
2. **不依赖 pnpm 安装，不改 lockfile**。alias 工作在 rspack resolve 层，
   完全绕过 `node_modules` 目录结构。实测 pnpm 9.7.1 下往
   `pnpm-workspace.yaml` 的 `overrides` 里写 `link:` 条目会被**静默忽略**
   （`pnpm-lock.yaml` 无任何变化，`apps/mindx/node_modules/@tencent/docs-ai-page-visual-editor`
   仍软链到 `.pnpm/...@0.29.1`）——所以 **不需要也不要**去改
   `pnpm-workspace.yaml` / `package.json`，那是无效改动，只会污染 diff。
3. **不走 `tryEnterLinkMode` 的双重校验**。该函数会读 `package.json` 的
   `pnpm.overrides` 判断 `link:` 是否激活；pnpm 9 已不再读该字段，所以它对
   smart-page 场景恒为 false。`applyDocsAiPageLocalDevtools` 因此以
   `.docs-ai-page-local` marker 文件为**单一开关**（存在即开，删除即关）。
4. **alias 必须带 `$` 精确匹配**。visual-editor 的 `exports` 有 6 个入口
   （包根 + `react` / `core` / `adapters` / `collab` / `inject`），全部指向同一个
   `dist/index.esm.js`。子路径 alias 不写 `$` 会退化成前缀匹配，把
   `pkg/react` 拼成 `dist/index.esm.js/react` 导致解析失败，所以 6 个别名
   逐个精确列出。

另外 **react / react-dom dedupe 是必须的**：dist 物理位于 smart-page 仓内，
其 node_modules 链上没有 react（peer 未安装），不 alias 会直接
`Can't resolve 'react'`；即便能 resolve 也会形成两份 React 实例。

不需要 swc exclude / svg 规则：dist 是纯 JS（svg 已内联为 dataURL），不匹配
ts/tsx 规则，也不产生 svg 请求。dist 的其余裸包依赖（`css-select` / `css-tree` /
`htmlparser2` / `@tencent/docs-ai-page-sandbox`）都能从 smart-page 物理路径的
node_modules 链正常 resolve，无需处理。

### 启用步骤

```bash
# 1. smart-page 侧先 build 出 dist（联调的前提）
cd <smart-page-path>
npx nx run @tencent/docs-ai-page-visual-editor:build
#   或增量 watch：npx nx run @tencent/docs-ai-page-visual-editor:watch

# 2. 校验产物存在
test -f <smart-page-path>/packages/ai-page/visual-editor/dist/index.esm.js \
  && echo "dist OK"

# 3. mindx 侧写 marker 文件（单一开关）
cd <mindx-path>
echo "<smart-page-path>" > .docs-ai-page-local

# 4. build-config 改过才需要重编（首次接入 / 改 plugin 时）
CODEBUDDY_SAFE_DELETE_ENABLED=0 pnpm --filter @mindx/build-config build

# 5. 起 dev（终端会打出 🔗 docs-ai-page 联调横幅）
pnpm dev
```

> `.docs-ai-page-local` 已加入 `.gitignore`；`echo` 写入前**不要**加尾随 `/`。

### 日常迭代循环

改完 smart-page 源码后：

```bash
cd <smart-page-path> && npx nx run @tencent/docs-ai-page-visual-editor:build
```

mindx 侧 rspack watch 会检测到 `dist/index.esm.js` 变化并自动重编 → 浏览器刷新
即生效，**不用重启 dev**。只有改动 `smart-doc-editor-local.ts` 这个 plugin 本身
或 mindx 的 rspack 配置时才需要重 build build-config + 重启 dev。

> 想省掉手动 build，可以在 smart-page 侧常驻
> `npx nx run @tencent/docs-ai-page-visual-editor:watch`。

### 禁用

```bash
rm .docs-ai-page-local
```

重启 dev 即回到 registry 版本（不需要 `pnpm install`——从来没改过依赖树）。
若之前误往 `pnpm-workspace.yaml` / `package.json` 写过 `link:` overrides，
一并删掉这些无效条目，保持 `git diff` 干净。

### 状态查询

```bash
test -f .docs-ai-page-local \
  && echo "smart-page: $(cat .docs-ai-page-local)" \
  || echo "smart-page: (未启用)"
# 实际用的是 registry 还是本地 dist，看 dev 启动横幅最直接
```

### 命中过的坑

| 现象                                                  | 原因                                                  | 处置                                                                               |
| :---------------------------------------------------- | :---------------------------------------------------- | :--------------------------------------------------------------------------------- |
| 写了 `pnpm-workspace.yaml` overrides `link:` 却没生效 | pnpm 9.7.1 静默忽略该字段的 link 协议，lockfile 不变  | 不用管它，alias 路径本来就不依赖安装；把这段无效 overrides 从 diff 里删掉          |
| 联调配置切分支后整个消失                              | marker 文件 gitignore + plugin 代码是未提交工作区改动 | 切分支前记录改动；丢失后按「启用步骤」全量重建（历史上已丢过一次）                 |
| dev 起来仍是 registry 行为、无 🔗 横幅                | marker 缺失 / 路径不是绝对路径 / dist 不存在          | 逐项核对「启用步骤」第 2、3 步                                                     |
| 改了 smart-page 源码但 mindx 没变化                   | 忘了在 smart-page 侧 build                            | 跑 `nx run @tencent/docs-ai-page-visual-editor:build` 或开 `:watch`                |
| `Can't resolve 'react'` 指向 smart-page 路径          | dist 在 smart-page 仓内，peer react 未安装            | 确认 `applyDocsAiPageLocalDevtools` 的 react/react-dom dedupe 生效（rootDir 正确） |
| `Module not found: .../dist/index.esm.js/react`       | 子路径 alias 漏了 `$`，退化成前缀匹配                 | 6 个别名全部带 `$`                                                                 |

## 跨 commit / 协作注意事项

### 不要把 link overrides 推到远程

| 文件                      | 是否入库  | 理由                                             |
| :------------------------ | :-------- | :----------------------------------------------- |
| `package.json`（根）      | ✅ 入库   | 但 `pnpm.overrides` 段在启用本地联调期间是脏状态 |
| `pnpm-lock.yaml`          | ✅ 入库   | 但启用本地联调期间会出现 `link:` 条目            |
| `.smart-doc-editor-local` | ❌ 不入库 | 已在 `.gitignore`                                |
| `.smart-engine-local`     | ❌ 不入库 | 已在 `.gitignore`                                |
| `.docs-ai-page-local`     | ❌ 不入库 | 已在 `.gitignore`                                |

**启用本地联调后，提交前先执行动作 2 切回 npm 包**，确保 `pnpm.overrides` 与 lockfile 干净。

> smart-page 联调不改 `package.json` / lockfile / `pnpm-workspace.yaml`（改了也无效），
> 所以只要 marker 文件在 gitignore 里，它天然不污染 diff——commit 前只需确认没有
> 残留的手写 `link:` overrides。

### CI 不受影响

CI 直接 `pnpm install --frozen-lockfile`，lockfile 在远程是 npm 版本，不会有任何 link 解析。本 skill 是**纯本地开发态工具**。

### 与 catalog 升级流程的协作

跑 `workspace-doc` skill 升级 smart-doc-\* 版本时，**必须先 `/smart-doc-local off` 切回 npm**，再升 catalog 版本，再决定是否重新链回本地。否则 `pnpm-workspace.yaml` 的 catalog 版本号变化在 link 模式下被 overrides 屏蔽，看不到任何效果。smart-engine 的版本升级同理。

## 一些设计澄清

- **为什么用 `pnpm.overrides` 而不是把外部仓加进 workspace？** 两个外部仓都是独立 git 仓，有自己的 release / 工具链，并入 workspace 会污染 mindx 的 lock / hooks / CI 流程。`overrides` 允许跨仓库链接而保留各自工具链独立。
- **为什么不用 yalc？** yalc 吃 build 产物，不能调源码——与本 skill 目标矛盾。
- **为什么 editor 侧用动态发现而不是维护包清单？** editor monorepo 有近 20 个 `@tencent/smart-doc-*` 子包（editor / convert / ui / record / spec / theme + 一堆 plugin-\*），且会持续新增。写死清单必然漏（历史上 skill 只列了三件套，实际 mindx 还依赖 plugin-mention / plugin-collab-cursor / smart-doc-ui 等）。改成扫描 editor 仓 + 与 mindx 实际声明取交集后，editor 仓新增 plugin 时自动覆盖，无需同步改 skill。
- **为什么 editor 走 `conditionNames` 而 engine 走 `resolve.alias`？** editor 仓所有 `@tencent/smart-doc-*` 包的 `package.json.exports` 都已声明 `"source": "./src/index.ts"` 条件，rspack 加 `'source'` 到 conditionNames 即可命中；smart-engine 是传统 main/module/types 形态没有 exports 字段，conditionNames 救不了，只能用 alias 直接把包名重定向到 src/index.ts。
- **多包同时联调怎么办？** editor monorepo 下所有 `@tencent/smart-doc-*` 包是同一个仓的不同子目录，一次动态扫描 + overrides 全部就位；smart-engine 是另一个独立仓另一组开关；smart-page 又是第三个独立开关（marker 文件 + alias）。三个仓互相独立可分别开关、可同时开——三个 plugin 在 createAppConfig 末尾依次叠加 patch，不共享状态。
- **类型解析？** editor 仓的 `exports.types` 仍指向 `dist/index.d.ts`，IDE 的类型来自 dist 的声明文件，需要被链接的仓**至少跑过一次 `pnpm build`** 让 `dist/` 里有 `.d.ts`；smart-engine 走 alias，IDE 直接看到 src TS 源码，类型零依赖 dist。
- **为什么需要在 mindx 这边补 `@editor/*` 别名？** editor 仓 `tsconfig.base.json` 声明了 5 个内部 paths（`@editor/{record,core,view,i18n,logger}`），`packages/editor/src` 内部 327 处 import 用这些别名互引。npm 发布版的 dist 已经被 rolldown 内联消解，所以 npm 用户从来看不到。但直链 src 时 rspack 看不到 editor 仓的 tsconfig paths，会一律 `Module not found`。`tools/build-config/rspack/plugins/smart-doc-editor-local.ts` 的 `buildAliasMap` 函数读取 `.smart-doc-editor-local` 配置，仅在 dev 模式下注入这 5 个别名指向编辑器仓的源码绝对路径，与编辑器仓自身保持唯一真相源；如果未来编辑器仓新增 `@editor/*` paths，需要同步更新该函数中的 `ALIAS_SUBDIRS` 数组。
- **为什么需要为 editor 仓的 svg 单独配 SVGR？** editor 仓的 icon 用 `export { ReactComponent as XxxIcon } from "./svg/xxx.svg"` 解构出**命名导出 `ReactComponent`**（CRA / SVGR 的传统约定），背后是它自己的 rolldown 用 `@svgr/core` 把 svg 转成 JSX 模块。npm 发布版的 dist 已经把所有 svg 内联编译为 JSX，npm 用户看不到这层细节。直链 src 时 rspack 默认把 svg 当 `asset/resource`（导出 URL 字符串），命名导出 `ReactComponent` 找不到 → warning。<br>同时 MindX 与共享 UI/设计资源的 svg 引用都是 `import url from "x.svg"` 默认导出 = URL 字符串，与命名导出形态**不能共存于同一条 rule**。`tools/build-config/rspack/plugins/smart-doc-editor-local.ts` 的 `buildSvgRule` 函数构造 `oneOf` 规则：第 1 条按 issuer 路径匹中 editor 仓后走 `@svgr/webpack`（与 editor 仓 rolldown 配置完全对齐），第 2 条兜底 `asset/resource`。两边互不污染。smart-engine 不带 svg 资源所以这一项不适用。
- **为什么 react/react-dom 需要 dedupe？** editor 仓 worktree 自己的 devDependencies 里固定 react@17（用于自身测试），rspack 解析 src 文件 import 时优先命中那份，与 mindx 业务代码用的 react@18 形成两份实例 → "Invalid hook call"。`buildAliasMap` 用 `createRequire` 从 mindx root 解析 react/react-dom 的真实路径，强制 alias 锁定到 mindx 的那份。smart-engine 是纯工具库不创建 React 实例，无此问题。
- **为什么 smart-page 吃 dist 而不吃 src？** 与 yalc 的差别在于**谁负责编译**：
  yalc 是把 npm 包产物拷贝进 node_modules（改源码不生效），而这里是 alias 直接
  指向 smart-page 仓**原地**的 dist——smart-page 侧 build/watch 一跑，mindx 侧
  rspack watch 立刻感知。既拿到了"改完就见效"的联调体验，又不用在 mindx 复刻
  visual-editor 的多入口 + CSS 注入 + workspace 依赖那套构建约定。代价是多一次
  `nx run ...:build`（可用 `:watch` 免手动）。
- **方案的隔离形态**：所有 link 联调相关的逻辑（编辑器侧条件名 `'source'` 注入、`@editor/*` alias、react dedupe、svg SVGR 分流、swc loader exclude 放行；smart-engine 侧 alias + swc exclude；smart-page 侧 6 个精确 alias + react dedupe）全部聚合在 `tools/build-config/rspack/plugins/smart-doc-editor-local.ts` 一个文件内，三个独立的 export 函数。`tools/build-config/rspack/app.ts` 主配置中只在 createAppConfig 末尾依次调用一次，未配置对应的 `.smart-*-local` / `.docs-ai-page-local` 文件时各自原样返回 config，对常规开发与 CI 完全透明。生产构建路径用 `if (isDev)` 守卫不会触及任一 plugin。

## 失败兜底

| 现象                                                                                         | 原因                                                                                                                                                      | 处置                                                                                                                                                                                                                                                                  |
| :------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 启用 editor 后 `pnpm dev` 报 `Cannot find module ...`                                        | editor 仓没装依赖                                                                                                                                         | 让用户在编辑器仓跑 `pnpm install`，再回来                                                                                                                                                                                                                             |
| `Module not found: Can't resolve '@editor/<sub>'`                                            | `applySmartDocEditorLocalDevtools` 没生效（`.smart-doc-editor-local` 缺失或路径不指向真实仓根）                                                           | 检查 `.smart-doc-editor-local` 内容是否为 editor 仓**绝对路径**且 `<path>/packages/editor/src` 存在；若编辑器仓新增了 `@editor/*` paths 项，同步 `tools/build-config/rspack/plugins/smart-doc-editor-local.ts` 中 `ALIAS_SUBDIRS` 数组                                |
| `Module not found: Can't resolve '@tencent/smart-engine'` 直链状态下                         | `applySmartEngineLocalDevtools` 没生效（`.smart-engine-local` 缺失或路径不指向真实仓根）                                                                  | 检查 `.smart-engine-local` 内容是否为 smart-engine 仓**绝对路径**且 `<path>/src/index.ts` 存在                                                                                                                                                                        |
| 某个 `@tencent/smart-doc-plugin-*` 包 link 后报 `Cannot find module`                         | 该 plugin 在 mindx 侧未被任何 app 声明依赖（pnpm 严格模式下未声明则无软链）                                                                               | 检查交集扫描是否正确；若 plugin 是被 editor 主包间接依赖（非 mindx 直接声明），可不写 overrides（rspack 会通过 editor 的 node_modules 解析）；确需 link 则手动在 app package.json 声明该依赖                                                                          |
| `Can't import the named export 'ReactComponent' ... from default-exporting module`           | svg 没经 SVGR 转 React 组件，被当成 `asset/resource` 默认导出了 URL                                                                                       | 检查 `tools/build-config/rspack/plugins/smart-doc-editor-local.ts` 的 `buildSvgRule`：issuer 函数判定 `resourcePath.startsWith(editorRepoPrefix)` 是否对当前 import 文件命中（editorRepoPrefix 来自 `.smart-doc-editor-local` 的绝对路径 + 尾随分隔符）。仓库名可任意 |
| `Invalid hook call ... more than one copy of React`                                          | editor 仓 worktree 自己装了 react@17 用于测试，rspack 解析 src 文件 import 时优先命中那份，与 mindx 业务代码用的 react@18 形成两份实例，dispatcher 互不通 | `applySmartDocEditorLocalDevtools` 已自动用 `createRequire` + `resolve("react/package.json")` 把 `react` / `react-dom` alias 强制指到 mindx 自身的 `node_modules`。如果仍出现，确认 `.smart-doc-editor-local` 配置存在、build-config 已重 build、dev 已重启           |
| dev server 启动后断点不命中源码 / sourcemap 是 dist                                          | rspack 没注入 `'source'` 条件名 / alias（说明 plugin 未触发）                                                                                             | 确认对应 `.smart-*-local` 存在且路径合法；查看 plugin 是否被 createAppConfig 正确依次调用                                                                                                                                                                             |
| 类型报红一片（editor 侧）                                                                    | editor 仓 dist/index.d.ts 缺失                                                                                                                            | 让用户在编辑器仓跑 `pnpm build`                                                                                                                                                                                                                                       |
| 类型报红一片（engine 侧），dev 又能跑                                                        | smart-engine 仓 `package.json.types` 指向 `es/index.d.ts`，但 `es/` / `lib/` 产物缺失（rspack alias 直接吃 src 所以 dev 不受影响，tsc / Node 解析才挂）   | 让用户在 smart-engine 仓跑 `pnpm build`，一次性产出 `es/` + `lib/`                                                                                                                                                                                                    |
| HMR 不刷新                                                                                   | swc 没编译外部源码（plugin 包装 exclude 失败）                                                                                                            | 检查 plugin 的 `wrapSwcExclude` 是否被正确应用到 swc loader 规则                                                                                                                                                                                                      |
| `pnpm install --no-frozen-lockfile` 报 peer 冲突                                             | editor 仓自身是 React 17，mindx 是 React 18                                                                                                               | 这是已知偏差但运行时兼容（编辑器仓 peerDeps 写的 `>=16.8.0`），可忽略 warning                                                                                                                                                                                         |
| `pnpm install` 报 `ERR_PNPM_PATCH_NOT_APPLIED`（如 `mdast-util-gfm-autolink-literal@2.0.1`） | `link:` 协议不解析被 link 包的 dependencies，仅由被 link 包间接引入的依赖从依赖图消失，导致其 patch 悬空                                                  | 见 1.5.1：启用期间临时从 `pnpm.patchedDependencies` 移除该条目，off 时（动作 2）写回                                                                                                                                                                                  |
| `pnpm install` 报 `[safe-delete][SAFE_DELETE_BULK_CONFIRM_REQUIRED]`                         | CodeBuddy IDE 注入的 `node-safe-delete` 拦截批量删除（link 切换会重排 node_modules，一次删除文件数 ≥500）                                                 | 命令前加 `CODEBUDDY_SAFE_DELETE_ENABLED=0`，见 1.5                                                                                                                                                                                                                    |
| smart-page / docs-ai-page 侧任何异常                                                         | 形态与前两者不同（吃 dist、不装依赖、marker 单一开关）                                                                                                    | 查「docs-ai-page（smart-page）联调 · 专章」末尾的坑位表，不要套用 editor 那套排查                                                                                                                                                                                     |
