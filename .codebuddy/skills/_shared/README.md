# `_shared/` — 跨 Skill 共享的 Reference

本目录存放**被多个 skill 同时引用**的公共 reference 文档，避免在各 skill 的 `reference/` 目录下重复拷贝，也避免用相对路径跨 skill 耦合（如 `../other-skill/reference/xxx.md`）。

## 命名约定

- 目录名 `_shared/` 以下划线开头，与业务 skill 目录（如 `start-feature/`、`cmd-publish/`）在字典序上明显分隔。
- 本目录**不是 skill**，没有 `SKILL.md`，不会被 skill 引擎扫描为可触发 skill。

## 引用方式

在任意 skill 的 SKILL.md 中，用相对路径引用：

```markdown
> 📖 **必读**：... 见 [\_shared/xxx.md](../_shared/xxx.md)。
```

## 当前文件清单

| 文件                 | 用途                                                                       | 引用方                                                                                             |
| -------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `mcp-degradation.md` | CNB CLI 不可用时的阻断策略、登录探活、禁止旧平台 fallback 规则             | `start-feature`、`cmd-publish`                                                                     |
| `issue-creation.md`  | 三类型 Issue 创建模板、需求池入口严格门禁、已有五态兼容与标签/CAS 复验规约 | `start-feature`、`prototype-workflow`、`implement-issue`、`cmd-publish`、`issue-binding-route.mdc` |

## 新增共享 reference 的判定

只有满足以下条件的 reference 才应进入 `_shared/`：

1. 被 **≥ 2 个 skill** 同时引用。
2. 内容是**业务无关的通用机制**（如容灾、重试、公共 schema）。
3. 引用方能独立演进，不依赖 `_shared/` 内部结构细节。

如果只被一个 skill 引用，应保留在该 skill 自己的 `reference/` 目录下。
