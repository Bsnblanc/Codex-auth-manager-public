# 系统完整验收报告 - 2026-03-22

## 目的

基于当前代码、产品需求文档、已完成修复和现有验证结果，梳理系统完整功能，并判断当前版本是否可以视为“功能都正常”。

结论先行：

- 核心主链已基本可用
- 但当前版本 **不能认定为“所有功能都正常”**
- 当前更准确的状态是：**核心功能大体可用，代码层主链已收口，但发布前人工验收仍未完成**

## 验收依据

### 需求基准

- `docs/product-spec.md`
- `docs/direct-codex-auth-compatibility.md`
- `docs/subscription-identity.md`
- `docs/quota-hover-marker-task-record.md`

### 代码范围

- Renderer：`src/App.tsx`、`src/styles.css`、`src/global.d.ts`
- Electron：`electron/main.cts`、`electron/opencode.ts`、`electron/store.ts`、`electron/auto-switch.ts`、`electron/live-auth-sync.ts`、`electron/quotas.ts`、`electron/types.ts`

### 已执行验证

- `npm run lint`：通过
- `npm run build`：通过

说明：

- 本报告主要基于代码审查、需求对照、静态验证和构建验证
- **尚未完成一轮完整的 Electron 人工交互回归**，因此不能把“构建通过”直接等同于“所有功能已验收通过”

## 功能总览

系统目标是统一管理两类授权：

1. `OpenCode` 模式授权
2. `Codex` 模式授权

并在一个单页应用中完成：

- 账号管理
- 导入 / 登录导入 / 导出 / 删除 / 重命名
- 当前账号切换
- 额度监测与状态展示
- 历史统计与图表
- 本地持久化

## 验收状态说明

- `通过`：代码实现与需求基本一致，当前未发现明确功能错误
- `部分通过`：功能存在，但与需求不完全一致，或存在已知行为缺口
- `未通过`：存在明确缺失、错误或发布阻塞问题

## 完整功能验收清单

### 1. 双模式基础能力

#### 1.1 OpenCode / Codex 两种模式存在

- 状态：`通过`
- 说明：当前模式决定登录命令、目标 auth 路径、可见账号、切换目标和导出格式

#### 1.2 当前模式决定行为边界

- 状态：`部分通过`
- 已完成：模式切换、当前路径展示、可用性判断、导出格式已按 mode 分流
- 仍有问题：renderer 端相关入口组织方式和 spec 描述不完全一致，部分功能入口不够直观

### 2. 账号管理能力

#### 2.1 本地 managed store

- 状态：`通过`
- 说明：应用维护独立 store，不依赖单一 live auth 快照；包含 revision、账号、设置、历史等

#### 2.2 新增 / 导入账号

- 状态：`部分通过`
- 已完成：支持文件导入、登录导入、live import 链路；导入后可尝试额度抓取；失败时保留账号并记录错误
- 已修复：导入后 renderer 状态应用与回放逻辑中的若干一致性问题
- 说明：`live import` 属于现有导入链路；`replace-from-live` 已确认不是单独的用户需求

#### 2.3 重命名 / 删除账号

- 状态：`通过`
- 说明：主进程已支持 rename / delete，并同步更新持久化状态

#### 2.4 去重与同账号合并

- 状态：`部分通过`
- 已完成：同 access token 会更新已有记录；store 加载时也会做重复合并
- 仍有问题：跨格式合并当前比 spec 更保守，要求 `accountId + userKey` 同时匹配，不完全等于 spec 里“同 accountId 就合并”

### 3. 授权格式与边界

#### 3.1 只管理 Codex / OpenAI 相关授权

- 状态：`通过`
- 已修复：不再兜底接受任意 OAuth provider 作为受管账号；只接受受支持 provider key

#### 3.2 OpenCode auth 保留无关 provider

- 状态：`通过`
- 说明：切换时只替换目标节点，其他 provider 保留
- 已修复：此前存在误选 provider 风险，当前已收紧识别边界

#### 3.3 Direct Codex 兼容导入与安全写回

- 状态：`通过`
- 已修复：direct Codex 识别现在要求 direct 必需字段，避免把不完整 direct 文件当成可安全写回对象

### 4. 切换与当前账号使用

#### 4.1 手动切换当前账号

- 状态：`通过`
- 说明：切换会先刷新 quota，再把目标账号写回当前模式的 auth 文件，并更新 active account id

#### 4.2 额度耗尽后自动切换账号

- 状态：`通过（代码层）`
- 已修复：`Codex` 模式下 auto-switch 现在会先过滤 mode-compatible 账号，避免选到不可写回的 OpenCode-only 账号
- 风险说明：虽然代码路径已修正，但**仍建议在真实 Electron 环境做一次耗尽场景人工回归**

### 5. 额度监测与刷新

#### 5.1 手动刷新全部 / 单账号

- 状态：`通过`
- 说明：当前支持全部刷新和单账号刷新，并持久化 quota snapshot

#### 5.2 active dynamic + background reset-based refresh

- 状态：`通过`
- 已完成：自动刷新调度已迁移到 main process，active 账号按动态间隔刷新，当前模式下的 background 账号按 reset time 优先唤醒；未知 reset 仍有低频兜底刷新
- 说明：renderer 旧的本地 timeout 调度已移除，状态改为由 main process 推送

### 6. 历史与统计

#### 6.1 本地 quota 历史快照

- 状态：`通过`
- 说明：刷新/导入后可记录 quota windows 历史，用于统计图表

#### 6.2 aggregate / per-account 历史图表

- 状态：`通过`
- 说明：点击 aggregate 或 account 后可显示聚合 / 单账号图表

### 7. Renderer 单页交互

#### 7.1 默认只显示总额度，不先展开图表

- 状态：`通过`

#### 7.2 hover 高亮 / 其他账号变暗

- 状态：`通过`
- 说明：此前零额度 marker 同时高亮的问题已修复

#### 7.3 click focus 后显示图表并让顶部额度条 morph

- 状态：`通过`

#### 7.4 新导入账号的回放提示动画

- 状态：`部分通过`
- 说明：当前具备 replay 逻辑和 spotlight 动画，但交互细节仍可继续优化；它不是当前最关键发布阻塞

### 8. 可视化与布局

#### 8.1 总额度条显示

- 状态：`部分通过`
- 已修复：左侧零额度 marker 溢出容器的问题已修复
- 说明：很小的 quota segment 当前采用最小可见宽度策略，以换取可读性

#### 8.2 小窗口高度下 overview 可见性

- 状态：`通过`
- 已修复：不再依赖页面滚动；矮窗口下 overview 改为顶部对齐和紧凑布局，避免被标题区域挡住

#### 8.3 右侧 side panel

- 状态：`不适用`
- 说明：该项已从当前产品要求中移除，不再作为验收失败项

#### 8.4 footer chip rail

- 状态：`通过`
- 说明：footer chip rail 为折叠式设计，默认隐藏切换按钮，仅在交互时出现；这是当前确认后的要求

### 9. 设置与可配置项

#### 9.1 当前模式 auth path 编辑

- 状态：`通过`
- 已修复：输入草稿不再被普通状态刷新覆盖

## 已确认并已修复的问题

本轮审查中，以下问题已确认并完成代码修复：

1. 初始 IPC 状态未校验就应用到 renderer
2. 过期状态仍触发成功副作用
3. auth path 草稿会被普通刷新覆盖
4. `Codex` 模式下额度耗尽 auto-switch 候选未按 mode 过滤
5. auth 识别边界过宽，可能误碰无关 provider
6. direct Codex 兼容判定过松
7. 零额度左侧 marker 溢出总额度容器
8. overview-only 状态在矮窗口下可能被标题区域挡住

## 当前仍未关闭的问题

以下问题目前仍然存在，不能说“功能全部正常”：

1. 尚未完成一轮完整 Electron 人工回归验收

## 发布判断

### 当前不能直接下的结论

- 不能说“所有功能都正常”
- 不能说“已经完成最终产品验收”
- 不能说“已经完成正式发布验收” 

### 当前可以下的结论

- 核心账号管理主链基本可用
- OpenCode / Codex 两种授权的统一管理框架已经建立
- 导入、导出、删除、重命名、手动切换、额度展示、图表展示这些主功能大体可工作
- 自动刷新主链已经落地
- 若干关键 bug 已修复
- 但仍有发布前人工验收待办项

## 最终结论

**结论：当前版本不是“功能全部正常”的最终验收通过状态。**

更准确的验收结论是：

- `核心功能可用`：是
- `关键错误已修一批`：是
- `完整需求全部通过`：代码层基本是，人工验收未完成
- `可直接正式发布`：否

## 建议的发布前最后闭环

1. 完成一轮 Electron 真机人工回归：
   - OpenCode 模式导入 / 切换 / 导出
   - Codex 模式导入 / 切换 / 导出
   - active account 耗尽后自动切换
   - 零额度 marker 左侧显示
   - 小窗口高度下 overview 布局

执行时请使用：`docs/final-electron-acceptance-checklist-2026-03-22.md`

当前这轮启动记录见：`docs/final-electron-acceptance-run-2026-03-22.md`
