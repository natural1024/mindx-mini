# 前端性能优化：思路与方案（Playbook）

> 沉淀自 #1835（三大品类 SDK 异步化）与 #1875（date-fns/隐性泄漏清除）两轮实战：
> 首屏 8.02MB → 2.38MB（**-70%**），冷缓存首帧 -23~33%，弱网 LCP 21.3s → 3.08s。
> 项目过程档案见 `docs/research/page-load-perf-baseline-1835.md` 与
> `docs/page-load-optimization-1835.md`；本文提炼**可复用的方法论**。

---

## 1. 总原则

1. **测量先行**：先建基线再动手。没有基线的优化无法证明收益，也无法发现劣化。
2. **口径一致**：优化前后必须同口径对比（同构建配置、同统计脚本、同环境）。混口径的对比是自我安慰。
3. **单变量验证**：一次只做一个改动，构建+运行时双验证后再叠加下一个。多改动叠加出问题时无法归因。
4. **纯减法优先**：优先做"整块移出"（-813KB/-950KB），其次才是碎片手术（图标/locale）。删掉的代码不需要维护。
5. **诚实面对数据**：预期落空时找机制解释（如"热缓存掩盖收益"），不要选择性汇报。

## 2. 瓶颈定位：双口径测量体系

### 2.1 构建口径（产物体积）

```bash
# 首屏 script/字节统计（index.html defer script 引用文件的未压缩大小合计）
NODE_ENV=production npx rspack build -c rspack.config.mjs
node -e '...统计脚本（见基线报告 §1.1）...'
# 深挖引用链：构建 stats（chunks/chunkModules/modules/reasons）
```

- **Top chunk 清单** + **按包归属**，定位大块
- stats 的 `reasons` 追引用边：谁把这个包拉进首屏的（issuer 链，注意 concat 模块 `A + N modules` 形态）

### 2.2 运行时口径（真实体验）

| 手段                                       | 适用         | 关键指标                                                |
| :----------------------------------------- | :----------- | :------------------------------------------------------ |
| Chrome Performance 录制（冷缓存+弱网模拟） | 控制变量实验 | 首帧截图时刻 / DCL / 请求瀑布                           |
| 伽利略 aegis RUM（线上）                   | 真实用户分布 | firstScreenTiming / LCP / FCP / ttfb / resourceDownload |
| staging trace                              | 深度归因     | 主线程 / 网络时序 / API 链                              |

### 2.3 分段归因（找到"谁的责任"）

`firstScreenTiming` 拆解：`ttfb(后端) + contentDownload(主文档) + resourceDownload(JS) + domParse + 未解释段(JS执行/渲染/串行API)`。

**先看占比再动手**：资源下载占比 11% 时，继续砍 bundle 的收益天花板就是 11%——这正是判断"前端到顶、转向后端"的依据。

## 3. 方案模式库（按优先级）

### 模式 A：懒加载边界（组件/路由级 React.lazy）

**适用**：首屏不需要的重型组件（品类页、评论、弹窗、编辑器壳）。

```tsx
const HeavyComponent = lazy(() =>
  import("./heavy").then((m) => ({ default: m.HeavyComponent })),
);
```

**关键机制（rspack/webpack）**：被 ≥2 个异步 chunk 共享的模块会被**提升到公共祖先（entry initial chunk）**——级联把整包 vendor 拽回首屏。**破解：在组件使用点 lazy 化**。

- 实战：doc-page/web-page 评论组件 lazy 化破了共享提升链；`WebPageCommentLayerMobile` lazy 化一次断链 -950KB。
- 易漏点：pc 侧 lazy 了 mobile 侧漏了（同组件族的**双端都要检查**）。

### 模式 B：SDK 引用收口（唯一动态 import 入口）

**适用**：对重 SDK 的零散 `import()` 调用点收敛。见 `services/category-sdk/`（每品类一个文件、只含 thunk、无 barrel）。

### 模式 C：静态多入口拆分（workspace 包 lib 单文件 bundle）

**适用**：重依赖能力被 lib 单文件 barrel 连带进消费方首屏（如 Calendar→react-day-picker→date-fns 813KB）。

```
lib/index.mjs（主 barrel，无重依赖）
lib/calendar.mjs（重能力独立入口） + exports "./calendar"
```

**两条铁律（review 踩坑换来的）**：

1. **子入口副作用自足**：主入口的 i18n 注册等 side effect 不会随子路径执行，子入口必须自带（`import "../i18n"`）
2. **样式入口配套暴露**：多 entry 会把该入口的 CSS 抽到独立文件（`lib/<name>.css`），exports 必须配套 `./<name>/styles`

**绝对禁止**：在 lib 内用 `import()` 做按需——**lib 内异步 chunk 会把对外部依赖的具名 import 改写为命名空间形式，破坏消费方 app 的 tree-shaking**（实测 phosphor 图标从 50 个炸到 1512 个 / 5MB）。

### 模式 D：分包规则（splitChunks cacheGroup）

已验证的组合（`tools/build-config/rspack/app.ts`）：

| 组 | 配置 | 作用 |
| :--------- | :---------------------------------------------------------- | :------------------------ | ----------------------------------------- |
| `sdkAsync` | `chunks:"async"` + priority 30 + `reuseExistingChunk:false` | 三大品类 SDK 强制留异步图 |
| `default` | `chunks:"async"` + minChunks 2 | 阻止共享模块提升回首屏 |
| `vendor` | 排除 SDK 系（`(?:[\\/]                                      | $)` 兼容包根 context） | SDK 不落 `chunks:"all"` 的 initial vendor |

**教训**：

- `sdkAsync` 的包名匹配用**全系正则**（`smart-doc-[a-z-]+`），逐名列举必然腐烂——SDK 升级拆伴生包（2.134.0 拆出 convert/record/spec/theme/ui）时漏配导致 84KB 泄漏
- cacheGroup `test` **函数形式**在 rspack 1.x 行为不可靠，用正则
- `chunks:"async"` 的组不接管「initial+async 混合引用」的模块——混合引用留 initial 是正常行为，需从引用源头（模式 A/C）解

### 模式 E：barrel 泄漏防范

**从 barrel 取一个导出 = 连带 barrel 里全部 `export from` 的兄弟模块及其重依赖**。三起实战事故（database 849KB / mobile 评论链 950KB / web-page barrel）全部同源。

**规则**：

- 首屏组件需要某品类页组件时**直连子路径**（`pages/database-page/pc`），不走品类页 barrel
- barrel 作者：`export from` 的分支若静态引重 SDK，该 barrel 就是首屏地雷
- 排查口诀：stats 里 issuer 全 async 但模块 initial → 沿 barrel 链向上找 initial 入口

## 4. 收益验证体系（四层递进）

| 层            | 手段                                             | 结论强度           |
| :------------ | :----------------------------------------------- | :----------------- |
| 1. 构建断言   | script 数/字节/残留 chunk 名 grep                | 确定性（物理事实） |
| 2. 冷缓存录制 | DevTools Disable cache + Performance，同机背靠背 | 强（控制变量）     |
| 3. 线上 RUM   | 伽利略按 version 分组，控平台/网络口径           | 中（有构成噪声）   |
| 4. 弱网 trace | Fast 3G + CPU 4x                                 | 极端场景上限       |

**收益场景梯度**（减 bundle 类优化的规律）：弱网（-86%）> 冷缓存（-23~33%）> 线上常规（-11%）> 热缓存（持平）。**热缓存持平不是没收益，是缓存把差异抹平了**。

## 5. 收益预期管理

- **字节 ≠ 首帧**：字节 -860KB 实测首帧只 -20ms——不在首帧关键路径的资源，减了也不加快首帧（影响的是总下载量/DCL/流量）。
- **边际递减**：第一批"整块搬走"单位工程量收益最大；之后每项的收益/成本比持续下降。设停损线（如"预期首帧 <50ms 的不做"）。
- **找对责任方再投入**：分段归因显示资源下载只占 11%、未解释段（串行 API/渲染）占 72% 时，继续优化前端字节是错配——转向 API 链并行化/后端 ttfb。

## 6. 防回归

1. 分包规则的注释里写清"为什么"（实测数据+事故编号），防止后人"简化"正则
2. SDK 升级时检查伴生包是否被 `sdkAsync` 全系正则覆盖
3. 新增首屏组件时自查：有没有静态 import 重 SDK/品类页 barrel（`services/category-sdk/README.md` 约定）
4. 可选加固（未实施）：CI 构建产物断言「三大 SDK/date-fns 不在 index.html」，与实现解耦的真不变量

## 7. 实战数据速查

| 战役        | 改动                                                                                          | 收益                                      |
| :---------- | :-------------------------------------------------------------------------------------------- | :---------------------------------------- |
| #1835 T2-T5 | 品类/路由/评论 lazy + sdkAsync 分包 + emoji locale 边界 + aegis 动态化 + database barrel 修复 | 8.02→4.24MB（-48%），弱网 LCP 21.3s→3.08s |
| #1875       | date-fns 静态多入口 + sdkAsync 全系正则 + web-page 链 lazy                                    | 4.24→2.38MB（-44%），res 资源下载 -51%    |
| **累计**    |                                                                                               | **8.02→2.38MB（-70%）**                   |

运行时收益（冷缓存同机对比）：HTML 首帧 -33%、MD -28%、CSV -23%；线上 wifi 对齐 fst -11%。
