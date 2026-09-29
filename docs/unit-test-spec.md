# TDD 单元测试规范

项目采用 TDD 模式开发，遵循**先编写测试用例，再编写代码**的原则。

任何功能改造、代码重构，都应该**同步维护测试用例，并确保测试用例全绿通过**。

## 测试框架

- vitest
- jsdom
- React Testing Library (RTL)

## 测试用例存放位置

测试用例应独立于源码单独存放，位于与 `src` 目录同级的 `test` 目录下，目录内部维持与 `src` 下相同的层级结构与命名。

示例：

```
- /ui-components/
  - /src/
    - /components/
      - /docs-search-box/
        - index.tsx
  - /test/
    - /components/
      - /docs-search-box/
        - index.test.tsx
```

## 测试用例覆盖范围

以下对象**必须**编写测试用例：

- `packages/ui-components`：
  - 所有组件（纯静态组件在仅 props 透传、无分支渲染时可选，一旦出现条件渲染或交互回调即为必测）
- `packages/core-data`：
  - 服务类（`src/services/**`）
  - 业务模型（`src/models/**`）
  - 通用工具（`src/utils/**`）
- `apps/mindx`：
  - React Hooks（公共 `src/hooks/use-*.ts(x)` 与 page 私有 `src/pages/*/hooks/use-*.ts(x)`）
  - 服务类（`src/services/**`）
  - 通用工具（`src/utils/**`）

> Service 类是业务数据读写、接口请求/响应转换、跨模块协调的核心承载点，**任何 service 类在新增或修改时都必须同步维护测试用例**，缺测会在 `test-agent` 的缺测补齐扫描中被强制补齐。

## 测试用例编写原则

### 类测试原则

重点关注所有的 public 属性与方法。

**Service 类专项要求**：

- 每个 public 方法至少覆盖 1 条成功路径 + 1 条异常/边界路径（例如接口报错、空数据、参数非法、并发冲突等）。
- 外部依赖（HTTP、存储、其它 service、全局单例等）必须通过 vitest 的 `vi.mock` / `vi.spyOn` 隔离，不得让测试真的发出网络请求或触达真实副作用。
- 关注 service 方法对返回值的**结构转换**（业务数据 ↔ UI 数据 / 业务数据 ↔ 接口 payload）是否与约定一致。

### 组件/视图测试原则

- 不要测试实现细节：不要去检查组件的 state 或 private methods。只要 UI 表现正确，内部怎么写不重要。
- 优先使用 findBy：当你需要等待异步操作（如 API 渲染）完成时，使用 await screen.findBy...。
- 使用 user-event：虽然 fireEvent 很快，但 user-event 库能更真实地模拟用户行为（如输入字符会触发 keydown/keyup）。
- 覆盖分支逻辑：确保测试了组件的不同状态：加载中、错误状态、空数据状态。
