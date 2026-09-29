# 分支路由解析（Reference）

> 本文件定义分支路由的解析细节，被 `start-feature` Phase 1 和 `cmd-publish` Phase 2 引用。

---

## 1. 读取路由配置

并行读取两个文件：

```bash
# 团队路由配置
ROUTE_CONFIG=$(cat .vibe/branch-routes.json 2>/dev/null || echo '{}')

# 个人本地活跃路由
ACTIVE_ROUTE=$(cat .vibe/active-route 2>/dev/null || echo '')

echo "ROUTE_CONFIG: $ROUTE_CONFIG"
echo "ACTIVE_ROUTE: $ACTIVE_ROUTE"
```

---

## 2. 路由优先级

按以下优先级确定当前路由：

1. **本地活跃路由优先**：`.vibe/active-route` 存在且非空 → 取其值作为 `route_id`，在 `routes` 数组中查找匹配项。
2. **角色默认路由**：无活跃路由时，根据用户角色从 `default_route` 获取：
   - 开发者 → `default_route.developer`
   - 产品经理/设计师 → `default_route.designer`
3. **兜底**：以上都找不到，使用 `target_branch: main`，`source_branch: main`。

---

## 3. 多路由交互式选择

> 仅当 `routes` 数量 ≥ 3 且本地无活跃路由时触发。
> ⚠️ **当前 production 路由仅有 `main` 单条**。prototype 由 `prototype-workflow` 固定从 `origin/main` 创建，不参与可合并路由选择。

**对开发者**：展示可用路由列表

```
📌 检测到多个活跃路由，请选择本次工作的目标：
1. main — 研发主干 → main
2. share_team — 分享到团队 → feature/share_team_12345

输入序号或路由 ID 选择，之后可随时通过 /switch-route <id> 切换。
```

**对产品经理/设计师**：屏蔽技术细节

```
📌 当前有多个需求在并行开发，请告诉我你这次要做的是哪个需求？
1. 产品设计沙箱（日常设计和组件开发）
2. 分享到团队（分享功能相关）
3. 通知中心（通知功能相关）
```

用户选择后，将选中的 `route_id` 写入 `.vibe/active-route`。

---

## 4. 输出路由结果

最终记录为三个变量：

- `route_id`：路由 ID
- `target_branch`：MR 合入目标
- `source_branch`：feature 分支的基点
