# Changelog

本项目的版本历史。版本号遵循语义化版本（SemVer）：`MAJOR.MINOR.PATCH`。

## [1.1.0] - 2026-08-18

### 新增：兼容 DSH 0.1.0-rc.7（及同系列更高 rc 版本的基础架构）

#### 变更内容

- **manifest 升级为 v2 多版本结构**（`patches/manifest.json`）：
  - `versions[]` 数组，每个条目锁定一个 DSH 版本及其 17 个目标（版本、hash、锚点对）；
  - 现支持 `0.1.0-rc.6`（原 1.0.0 补丁集）与 `0.1.0-rc.7`（新增补丁集）；
  - 未来新 rc 版本可继续追加条目（发布新版本主题包）。
- **apply.mjs 按安装版本自动选择补丁集**：
  - 读取 DSH 根 `package.json` 的 `version`，精确匹配支持的版本条目；不匹配时明确报错并列出支持版本（退出码 1、零写入）；
  - 各版本条目的目标包版本校验（`packageVersion`）独立。
- **rc.7 补丁集生成**（内嵌于 `patches/manifest.json` 的 `versions[1]`，17 个目标）：
  - rc.7 官方与 rc.6 官方相比，17 个目标文件全部有差异（部分为等长替换、键序重排；`dsh-web-frontend` bundle 文件名变为 `index-C-1AiF3k.js`）；
  - 6 个包锚点完全兼容直接复用；10 个包的部分锚点（CSS 行 / module map 尾部）按 rc.7 文本重做（map 键插入、逗号规范化、上游 CSS 差异移植）；
  - `dsh-web-frontend` 4 个 Menu 锚点在 rc.7 bundle 中验证恰好匹配（上游 Menu 组件未变），直接复用。
- **健壮性修复**：写盘阶段不再输出日志（先全部写盘、后统一报告），杜绝 stdout 管道提前关闭（EPIPE）导致写盘循环中断的半补丁状态。

#### 验证（模拟环境，未触碰真实安装）

- rc.7 模拟安装：apply 17/17 成功，安装态全部文件 `node --check` 语法有效；卸载后与 rc.7 官方 tarball **17/17 逐字节一致**；幂等 ✓。
- rc.6 回归：apply 后与真实安装（rc.6 动效版）**17/17 逐字节一致**；卸载后与 rc.6 官方 **17/17 一致**；EPIPE 截断下写盘完整性 ✓。
- 版本不匹配（`0.1.0-rc.9`）：明确报错、列出支持版本、退出码 1、零写入 ✓。

## [1.0.0] - 2026-08-18

### 首个正式版本

把当前 DSH 安装（`@deepseek-ai/dsh@0.1.0-rc.6`）中**全部已定稿并生效的 UI 动效改动**固化为主题包，共 **17 个文件**：

#### 新增内容

- **安装/卸载/检查一体脚本** `bin/apply.mjs`：
  - `apply`（安装，幂等）、`--revert`（卸载，逐字节还原）、`--check`（状态检查）、`--dry-run`（演练）、`--target`（显式指定安装根）；
  - 三重版本校验（DSH 版本 + 目标包版本 + 文件 hash）+ 锚点恰好一次计数 + 应用后 hash 复核 + 两阶段提交（全部校验通过才写盘，失败零写入）。
- **补丁清单** `patches/manifest.json`：锁定 DSH `0.1.0-rc.6`，17 个目标（16 个 `dsh-client-*` 包 `lib/client.js` + `dsh-web-frontend` dist bundle），每条含原版/安装态 SHA256 与精确锚点对。

#### 打包的动效（与当前安装逐字节一致，只搬运不重写）

| 文件 | 动效 |
|------|------|
| dsh-client-ui-settings-general | 设置面板开合（mask/panel 入场、overlay 出场 170ms 延迟卸载）；导航激活项飞移 frame（WAAPI 340ms）；内容切换入场（450ms 定时器 + .4s） |
| dsh-client-ui-settings-plugins | 插件卡片 body 折叠（grid-fold .22s/.2s）；标签滑动指示条（.18s）；panel 入场（.16s） |
| dsh-client-ui-settings-models | 模型行高级展开折叠 ×2（grid-fold）；添加提供方卡片进出场（双 rAF + 180ms）；自定义设置 details 高度动画（.26s/.22s + 400ms 兜底） |
| dsh-client-ui-settings-plugin-inventory | 插件列表卡片详情折叠（grid-fold .24s/.2s）；**手风琴行为保持**（一次只展开一张） |
| dsh-client-ui-conversation | 工具审批面板出入场（.26s/.16s + 170ms 延迟提交）；消息入场（用户 .18s / 助手 .2s）；上下文注入行折叠；TodoPanel 折叠 + chevron 翻转；ContextMeter 面板入场（.26s）；会话切换 pane 入场（.4s + 450ms）；顶栏标签指示条（.18s）；回车行为行 chevron 旋转 |
| dsh-client-ui-model-selection | 两级菜单翻页（pane 滑入滑出 .24s + 高度过渡 + rAF 解锁）；菜单关闭延迟卸载（160ms + 出场 .15s）；**推理等级滑块**（全新 UI：渐变填充、26 颗流星粒子、ripple、tick、thumb 过渡，全部带 reduce 守卫） |
| dsh-client-ui-layout | 悬浮侧边栏配套布局（sidebarCol 去背景/内边距）；侧边栏拖拽展开（rail 拖出展开、松手切换、手柄加宽） |
| dsh-client-ui-sidebar | 悬浮侧边栏样式（圆角 24px + squircle + 阴影） |
| dsh-client-ui-workspace | 行入场（.25s/.2s backwards）；选中行 frame + View Transition 滑动（.34s）；行离开淡出（.15s + 180ms 延迟归档/删除）；分组折叠延迟（160ms）+ 级联入场（45ms/行）；视图切换交叉淡化（.22s/.34s）；菜单锚点修复 |
| dsh-client-ui-theme | 注入 CSS 扩展：Menu 进出场（.15s）、Modal mask/dialog 入场（.18s/.22s）、Toast 入场（.2s） |
| dsh-client-ui-tool | 工具行 body 折叠（grid-fold .22s/.16s） |
| dsh-client-ui-commands | 命令菜单卡片入场（.26s） |
| dsh-client-ui-input-trigger | 输入触发菜单入场（.26s） |
| dsh-client-ui-permission-presets | 权限预设行 chevron 旋转（.12s） |
| dsh-client-ui-agent-preset | Agent 预设行 chevron 旋转（.12s）；seat chevron 过渡规则 |
| dsh-client-locale | 语言行 chevron 旋转（.12s） |
| dsh-web-frontend（shell dist） | Menu 浮动面板关闭延迟卸载（160ms + `dsh-menu-closing` 类） |

#### 已知事项与决策记录

- **Modal 动画认知修正**：任务书口径"全局 Modal 动画已整包回滚、当前产物中不存在"经物证核实为——shell JS 的出场 + 延迟卸载确已回滚（bundle 无残留），但 Modal **入场**动画（mask .18s / dialog .22s）与 Toast 入场（.2s）经 theme 插件 CSS 注入**当前生效**。经用户确认，按"生效中"纳入打包。
- **shell dist 改动**：物证显示 bundle 存在 Menu 关闭延迟卸载（+334B，还原验证与干净副本逐字节一致）。经用户确认纳入打包（任务书原口径"不得触碰 shell dist"以此修正）。
- **已回滚项确认未打包**：插件列表多开（当前为手风琴 `expanded === entry.entryId`）、主题切换 View Transition（layout 无残留）、Modal 出场动画（bundle 无 `setMounted`/`dsh-modal-closing`）。
- **未在本机真实安装测试**：按用户要求，全部验证在隔离的模拟安装目录完成（应用后与真实安装逐字节一致、卸载后与官方原版逐字节一致、版本不匹配/锚点破坏报错且零写入）；由用户在其他机器上做最终验收。
