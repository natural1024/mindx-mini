---
name: theme-guard
description: |
  编辑器样式主题守卫。按当前分支判定 prototype 或 implementation，
  约束 smart-doc-editor 主题修改范围，并坚持 SDK Token 优先策略。
  触发关键词：编辑器样式、编辑器主题、editor style、editor theme、修改编辑器颜色、
  修改编辑器字体、修改编辑器间距、调整编辑器样式、theme token、overrides、
  编辑器 UI 样式、菜单样式、toolbar 样式、block 样式、同步主题、sync theme。
---

# Theme Editor Guard

Use this skill for smart-document editor appearance changes. Use `workspace-doc` as well when the request changes editor behavior, plugins, SDK APIs, or SDK versions.

## 0. Resolve the mode from the branch

Read the current branch before choosing any path. Branch mode is authoritative; a historical demo/design-system path in a prompt must not override it.

| Mode             | Branch / explicit intent                                               | Writable editor surface                                                                           | Validation                                                                                                                   |
| :--------------- | :--------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------ | :--------------------------------------------------------------------------------------------------------------------------- |
| `prototype`      | `prototype/<issue>-<slug>`                                             | The real consumer under `apps/mindx/src/components/doc-editor/**`, including its `theme/**` files | Verify the affected real MindX route; use `prototype-deploy` to create a packaged checkpoint when product feedback is needed |
| `implementation` | `feature/**`, `bugfix/**`, or another production implementation branch | The real consumer under `apps/mindx/src/components/doc-editor/**`, including its `theme/**` files | affected MindX route plus production lint/typecheck/tests                                                                    |

Hard routing rules:

- In `prototype` mode, product/design may directly edit the real `apps/mindx` editor theme and adjacent consumer styles needed by the requested result. Do not redirect the work into a design-system preview.
- In `implementation` mode, use the same real `apps/mindx` consumer path. Do not create a parallel mirror.
- Never dual-write, mirror, copy, or force-sync the MindX theme into another application.
- Never use destructive directory replacement, delete-then-copy, or whole-directory overwrite as a theme workflow. Apply reviewed, minimal diffs to the selected mode's source of truth.

Emit the resolved route before editing:

```text
[ThemeGuard] mode=<prototype|implementation> root=<writable-root> validation=<command-or-route>
```

If the branch is neither a legal prototype nor a production implementation branch, stop with `reason=MODE_UNRESOLVED`.

## 1. Confirm that the request is editor styling

This skill covers:

- content blocks such as headings, lists, code, callout, quote, tables, and selection;
- editor UI such as floating toolbar, menus, slash menu, handles, and command palette;
- editor container background, spacing, radius, typography, color, and shadow;
- smart-doc theme Tokens and narrowly scoped visual overrides.

Route page shell, sidebar, header, navigation, unrelated business UI, and global UI-component Tokens to the appropriate UI skill. If the requested change also alters component props, state, commands, editor behavior, or data flow, load `workspace-doc`; theme-guard alone does not authorize logic changes.

## 2. Discover the actual consumer before editing

Within the mode's writable root:

1. Locate the rendered PC/mobile consumer and its imports of `theme/index.less` and `theme/theme-config.ts`.
2. Inspect its actual root scope class, such as the current `.smart-doc-editor-pc`; never transplant a preview-only selector such as `.ds-editor-style-preview` into MindX without evidence that the real DOM uses it.
3. Select only the affected surface:
   - PC theme: `.../doc-editor/pc/theme/`;
   - mobile theme: `.../doc-editor/mobile/theme/`;
   - an adjacent consumer stylesheet only when no theme file owns the visual rule.
4. Preserve page boundaries and imports. A theme request is not permission to restructure the editor wrapper.

The normally editable files under a selected consumer are:

```text
theme/index.less
theme/tokens/{colors,spacing,typography,dark-theme}.less
theme/overrides.less
theme/theme-config.ts
```

`index.less` and token index files normally remain wiring-only. Touch the consumer `.tsx` or a non-theme stylesheet only when the requested visual behavior cannot be expressed by the theme surface, and then load the relevant UI/editor skill too.

## 3. Inspect the installed SDK Token surface

Before changing a `--sc-*` value, read the installed `@tencent/smart-doc-editor` sources from the actual resolved package path. Check the app-local and root `node_modules` locations, including pnpm's resolved package path when necessary; do not assume a fixed historical path.

Compare the relevant SDK files:

- `dist/view/theme/tokens/colors.less`;
- `dist/view/theme/tokens/spacing.less`;
- `dist/view/theme/tokens/typography.less`;
- layout/theme variants consumed by the affected Token.

Also read the current SDK version from `pnpm-workspace.yaml`/lockfile. If a Token was added, removed, renamed, moved, or had a material default change, report the SDK version, exact Token, affected MindX file, and proposed treatment before editing.

## 4. Token-first decision tree

Use this strict priority:

1. **SDK CSS Token** — override the existing `--sc-*` Token in the matching `tokens/*.less` file.
2. **Scoped CSS override** — only when no SDK Token expresses the result; add the narrowest rule to `overrides.less` with a comment naming the missing desired Token.
3. **JS theme config** — only when the SDK exposes the setting solely through its JS Theme API and CSS cannot express it.
4. **Blocked / SDK request** — when none of the above is safe.

Never configure the same property in both CSS Tokens and `theme-config.ts`. Prefer MindX semantic variables such as `var(--text-primary)` over raw values; when a literal is unavoidable, document the design source and dark-mode impact.

### CSS custom-property inheritance

SDK defaults may be declared on a closer descendant such as `[data-sc-theme]`. A value on the editor wrapper can then lose through DOM inheritance even though its selector looks more specific. Inspect the real DOM and SDK declaration. When necessary, repeat the Token at the closest stable consumer-owned `[data-sc-theme]` descendant under the real editor root; do not broaden it globally.

### `overrides.less`

Each new selector must be scoped to the real editor root and include:

```less
/* Missing SDK Token: --sc-<proposed-name>.
 * Reason: <why a Token cannot express this today>.
 */
```

Use `!important` only when the inspected SDK cascade requires it, not by default. Keep selectors narrow and validate light/dark plus affected interaction states.

### `theme-config.ts`

Use only for SDK JS Theme API fields with no CSS equivalent. Modify only the smallest relevant namespace (normally spacing or typography), explain the source of numeric values, and verify no corresponding `--sc-*` Token exists.

## 5. Implement and validate in the resolved mode

Make a minimal diff, then validate the actual consumer:

- `prototype`: open the affected MindX document route and verify the requested state in the executable prototype. Share the current worktree through `prototype-deploy` when product feedback is needed; it builds and packages the dirty tree without requiring a commit or push.
- `implementation`: run the affected MindX route and package lint/typecheck/tests required by the change.

For every mode check the relevant PC/mobile surface, light/dark scheme, hover/focus/selected/read-only states that the change can affect, and browser console errors. A design-system preview may be used as optional inspection evidence but is never an intermediate source that must be synchronized.

## 6. Completion report

```text
[ThemeGuard] status=COMPLETE mode=<mode>
- Files: <exact files>
- Strategy: <SDK Token | scoped override | JS Theme>
- SDK evidence: <version and inspected Token/source>
- Runtime evidence: <actual route and states checked>
- Cross-app synchronization: none
```

If blocked, report the missing SDK capability and the narrowest proposed upstream Token/API instead of bypassing the mode boundary.

## Token quick map

| Goal                                  | First file to inspect                            | Typical SDK surface                                             |
| :------------------------------------ | :----------------------------------------------- | :-------------------------------------------------------------- |
| colors, backgrounds, borders, shadows | `tokens/colors.less`                             | `--sc-ui-*`, `--sc-color-*`, block color Tokens                 |
| radius and spacing                    | `tokens/spacing.less`                            | `--sc-ui-radius-*`, `--sc-block-*`, editor/table/divider Tokens |
| typography                            | `tokens/typography.less`                         | `--sc-ui-font-*`, `--sc-content-font-*`, mono font              |
| dark scheme                           | `tokens/dark-theme.less` plus SDK theme selector | affected `--sc-*` Tokens                                        |
| SDK has no Token                      | `overrides.less`                                 | narrow consumer-scoped selector                                 |
| JS-only SDK configuration             | `theme-config.ts`                                | documented JS Theme API field                                   |

## Related skills

- `workspace-doc`: editor behavior, plugins, SDK API, and version work.
- `ui-development`: page shell and non-editor UI.
- `dev-workflow`: change classification and Code/Review/Test orchestration.
