# 可获取字段说明

本文档按当前代码实现，完整记录这个应用现在到底能获取、解析、保存、显示哪些字段，并说明每一个字段的含义与当前用途。

## 1. 原始 auth 字段（原样保留）

这些字段来自本地 OAuth 记录，本项目会把它们保留在 `ManagedAccount.authFragment` 里，并在导出或切换账号时原样写回。

### `type`
- 含义：授权类型。
- 当前作用：用于判断该记录是不是 `oauth` 账号，只有 `oauth` 账号才能继续查询额度。

### `access`
- 含义：当前 OAuth access token。
- 当前作用：
  - 用来请求 `/wham/usage`
  - 用来解析 JWT 元数据
  - 当前唯一安全的自动判重依据

### `refresh`
- 含义：refresh token。
- 当前作用：
  - 本地保存
  - 导入导出时保留
  - 当前没有单独业务逻辑直接使用它

### `expires`
- 含义：access token 的过期时间。
- 当前作用：
  - 本地保存
  - 当前不直接参与 UI 展示和判重

### `enterpriseUrl`
- 含义：企业环境或自定义后端地址。
- 当前作用：
  - 决定额度请求使用哪个 usage 地址

### 其他未知键
- 含义：源 auth 对象里可能已有但当前未单独类型化的字段。
- 当前作用：
  - 原样保留
  - 不主动解析，不主动展示

## 2. JWT 中当前已解析并保存的字段

这些字段来自 OAuth `access` token 里的 JWT，当前会被解析为 `jwtMetadata`，并写入 `ManagedAccount.jwtMetadata` 与 `QuotaSnapshot.jwtMetadata`。

## 2.1 顶层 JWT 字段

### `audience`
- 含义：JWT 目标受众。
- 当前作用：仅保存，用于后续分析。

### `clientId`
- 含义：签发该 token 的客户端 id。
- 当前作用：仅保存。

### `expiresAt`
- 含义：JWT 过期时间。
- 当前作用：仅保存。

### `issuedAt`
- 含义：JWT 签发时间。
- 当前作用：仅保存。

### `issuer`
- 含义：JWT 签发方。
- 当前作用：仅保存。

### `jwtId`
- 含义：这次 JWT 的唯一 id。
- 当前作用：
  - 仅保存
  - 可区分一次具体 token
  - 不能当订阅唯一标识

### `notBefore`
- 含义：JWT 生效起始时间。
- 当前作用：仅保存。

### `passwordAuthTime`
- 含义：这次登录认证发生的时间。
- 当前作用：仅保存。

### `scopes`
- 含义：token 权限范围。
- 当前作用：仅保存。

### `sessionId`
- 含义：当前登录 session 的 id。
- 当前作用：
  - 仅保存
  - 可区分一次登录会话
  - 不能可靠区分订阅

### `sessionLogin`
- 含义：是否为 session 登录状态。
- 当前作用：仅保存。

### `subject`
- 含义：用户主体标识。
- 当前作用：
  - 仅保存
  - 能区分用户
  - 不能区分订阅

## 2.2 `https://api.openai.com/profile` 中的字段

### `email`
- 含义：用户邮箱。
- 当前作用：
  - 自动生成账号名称
  - 账号身份显示
  - 持久化保存
  - 不能可靠区分订阅

### `emailVerified`
- 含义：邮箱是否已验证。
- 当前作用：仅保存。

## 2.3 `https://api.openai.com/auth` 中的字段

### `accountId` (`chatgpt_account_id`)
- 含义：当前 JWT 中携带的 account / team 容器级标识。
- 当前作用：
  - 请求 usage 时写入 `ChatGPT-Account-Id` header
  - 账号元数据保存
  - 标签生成辅助
  - 当前是区分同一用户下不同 team / account 容器的最强信号
  - 不能被写成“官方 billing 订阅唯一 id”

### `accountUserId` (`chatgpt_account_user_id`)
- 含义：用户在某个 account / team 容器下的成员级复合 id。
- 当前作用：
  - 仅保存
  - 可辅助区分“同一 team 下的不同成员”
  - 不能单独当成 team 唯一键

### `computeResidency`
- 含义：计算驻留/环境策略。
- 当前作用：仅保存。

### `chatgptPlanType`
- 含义：JWT 中记录的计划类型。
- 当前作用：
  - 仅保存
  - 作为套餐类别辅助信息
  - 不能可靠区分订阅

### `chatgptUserId`
- 含义：ChatGPT 用户 id。
- 当前作用：
  - 仅保存
  - 能区分用户
  - 不能区分订阅

### `userId`
- 含义：用户 id。
- 当前作用：
  - 仅保存
  - 能区分用户
  - 不能区分订阅

## 3. `/wham/usage` 当前已解析并保存的字段

当前项目会把 usage 响应解析成 `QuotaSnapshot`。

## 3.1 顶层 usage 字段

### `planType`
- 含义：usage 返回的计划类型。
- 当前作用：
  - 账号元数据保存
  - 标签生成辅助
  - 不能可靠区分订阅

### `email`
- 含义：与本次 quota 快照绑定的邮箱。
- 来源：JWT，不是 usage 原生字段。
- 当前作用：随快照保存。

### `accountId`
- 含义：与本次 quota 快照绑定的 account id。
- 来源：JWT，不是 usage 原生字段。
- 当前作用：随快照保存。

### `jwtMetadata`
- 含义：与本次 quota 查询绑定的完整 JWT 元数据。
- 当前作用：后续分析和扩展。

### `source`
- 含义：快照来源。
- 当前作用：固定为 `wham`。

## 3.2 额度窗口字段

当前会解析三类窗口：
- `fiveHour`
- `weekly`
- `codeReview`

每个窗口都包含以下字段：

### `usedPercent`
- 含义：已用百分比。
- 当前作用：图表和状态计算。

### `remainingPercent`
- 含义：剩余百分比。
- 当前作用：
  - 额度条显示
  - 聚合计算
  - 自动切换判断
  - 历史折线图

### `resetAt`
- 含义：重置时间。
- 当前作用：
  - 悬浮提示
  - 时间展示
  - 节点状态说明

### `status`
- 含义：根据剩余百分比推导出的状态值。
- 可取值：`ok / warning / critical / empty / unknown`
- 当前作用：
  - 文案
  - 颜色
  - 线条/标记

## 3.3 credits 字段

### `hasCredits`
- 含义：是否存在 credits。
- 当前作用：决定是否显示 credits fallback。

### `unlimited`
- 含义：是否无限额度。
- 当前作用：显示为无限额度。

### `balance`
- 含义：credits 余额。
- 当前作用：
  - chip 显示
  - 悬浮显示
  - 当窗口百分比不可用时作为可视化 fallback

## 4. 本地会保存的账号状态

## 4.1 每个 ManagedAccount 保存的字段

### `id`
- 含义：应用内部账号记录 id。
- 当前作用：前端一切账号操作的主键。

### `label`
- 含义：显示名称。
- 当前作用：界面展示。

### `labelIsAuto`
- 含义：名称是否自动生成。
- 当前作用：决定后续是否允许自动重命名。

### `color`
- 含义：账号颜色。
- 当前作用：额度条和 chip 视觉区分。

### `providerKey`
- 含义：导入来源 provider 键。
- 当前作用：写回 OpenCode auth 时决定替换哪个节点。

### `authFragment`
- 含义：完整 auth 片段。
- 当前作用：
  - 导入导出
  - 激活当前账号
  - usage 查询

### `createdAt`
- 含义：创建时间。
- 当前作用：排序和记录。

### `updatedAt`
- 含义：更新时间。
- 当前作用：排序和状态变化记录。

### `lastSyncedAt`
- 含义：最近同步到 OpenCode 的时间。
- 当前作用：标记最近切换时间。

### `planType`
- 含义：账号当前已知计划类型。
- 当前作用：标签辅助、元数据保存。

### `email`
- 含义：账号邮箱。
- 当前作用：身份显示和自动标签。

### `accountId`
- 含义：账号级 id。
- 当前作用：元数据保存与辅助识别。

### `jwtMetadata`
- 含义：完整 JWT 元数据。
- 当前作用：后续扩展与人工分析。

### `lastQuota`
- 含义：最新额度快照。
- 当前作用：
  - 图表
  - 额度条
  - 自动切换
  - 当前状态显示

### `lastError`
- 含义：最近一次获取额度失败信息。
- 当前作用：导入失败或刷新失败时保留错误原因。

## 4.2 全局状态保存的字段

### `settings.opencodeAuthPath`
- 含义：OpenCode live auth 路径。
- 当前作用：导入当前 / 激活账号 / 登录后读取。

### `activeAccountId`
- 含义：当前实际给 OpenCode 使用的账号。
- 当前作用：
  - 当前账号高亮
  - 写回 OpenCode auth
  - 自动切换目标

### `history[]`
- 含义：历史额度快照数组。
- 当前作用：折线图与历史展示。

## 4.3 每个历史条目保存的字段

### `accountId`
- 含义：该历史记录属于哪个账号。

### `batchAt`
- 含义：采样时间。

### `windows`
- 含义：当时三个额度窗口的快照。

## 5. 当前 UI 实际显示的字段

当前界面直接或间接显示：

- `label`
- `color`
- `activeAccountId`
- 三个窗口的 `remainingPercent`
- 三个窗口的 `resetAt`
- 三个窗口的 `status`
- `credits.hasCredits`
- `credits.unlimited`
- `credits.balance`
- `history[].batchAt`
- `history[].windows.*.remainingPercent`
- `settings.opencodeAuthPath`
- 浏览器本地 `ocam-locale`
- 浏览器本地 `ocam-theme`

另外：
- `email/accountId/planType` 不作为独立列直接显示
- 它们会在主进程里参与自动生成 `label`

## 6. 这些字段各自能做什么

当前这些字段可以安全完成：

- 保存可复用的 OAuth auth 片段
- 用 access token 查询额度
- 显示 5 小时 / 周 / 代码审查额度
- 显示 credits 信息
- 生成账号标签
- 记录历史额度变化
- 区分一次具体登录态（`access`）
- 区分一个用户（`email / userId / chatgptUserId / subject`）
- 区分同一用户下不同 team / account 容器（`accountId`）
- 辅助区分同一 team / account 容器里的不同成员（`accountUserId`）
- 辅助识别套餐类别（`planType / chatgptPlanType`）

## 7. 这些字段不能安全做到什么

以下字段都不能被当成“订阅唯一标识”：

- `email`
- `accountId`
- `accountUserId`
- `planType`
- `chatgptPlanType`
- `chatgptUserId`
- `userId`
- `sessionId`
- `jwtId`
- `refresh`

原因：
- 它们可能在你认为“不同订阅”的记录之间重复
- 或者它们只是登录态、用户级、成员级、容器级信息，不是已被证实的 billing 订阅唯一键

补充边界：

- `accountId` 当前可以作为 team / account 容器的区分信号使用
- 但它仍然不能被写成官方稳定 `subscription_id`
- `accountUserId` 当前可以作为成员级区分信号使用
- 但它不能单独证明 team 唯一性或订阅唯一性

## 8. 当前安全匹配规则

当前项目采用的唯一安全自动匹配规则是：

- 两条记录只有在 `access token` 完全相同的时候，才视为同一条

这是当前 `sameSubscription()` 使用的策略。

## 9. 当前的硬限制

这条 `auth + JWT + /wham/usage` 链路里，当前**没有被证实可靠的订阅唯一标识**，例如：

- `subscription_id`
- `team_id`
- `workspace_id`

所以当前应用：

- 能可靠管理账号和额度快照
- 能安全去重完全相同的 token
- **不能安全自动判断两个不同 token 是否属于同一个订阅**
