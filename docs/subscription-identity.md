# 订阅 / Team 区分说明

本文档只基于当前项目代码已经拿到的字段，以及公开可查证的使用方式说明结论。

不做的事：

- 不把用户样本当成官方定义
- 不把猜测写成结论
- 不把 `accountId` 直接写成“官方 subscription_id”

## 1. 当前真正能拿到的链路

当前应用能稳定拿到三类信息：

- 本地 OAuth auth 片段：`access`、`refresh`、`expires`、`enterpriseUrl`
- JWT 解析字段：`sub`、`email`、`chatgpt_account_id`、`chatgpt_account_user_id`、`chatgpt_user_id`、`user_id`、`chatgpt_plan_type`、`session_id`、`jti` 等
- `/backend-api/wham/usage` 返回：`plan_type`、三类额度窗口、`credits`

当前代码来源：

- JWT 解析：`electron/jwt.ts`
- usage 请求与响应解析：`electron/quotas.ts`
- 字段持久化：`electron/types.ts`、`electron/store.ts`

## 2. 当前能可靠区分什么

### 2.1 能可靠区分“同一次具体登录态”

可用字段：

- `access`
- `refresh`
- `sessionId`
- `jwtId`
- `issuedAt / expiresAt`

含义：

- 这些字段能区分不同 token、不同会话、不同签发批次。
- 它们适合识别“是不是同一次登录”。

限制：

- 不能用来判断是不是同一个 team。

### 2.2 能可靠区分“是不是同一个用户”

可用字段：

- `sub`
- `chatgptUserId`
- `userId`
- `email`

含义：

- 这些字段更接近用户级身份。
- 在当前证据范围内，它们适合判断“是不是同一个人”。

限制：

- 不能单独用来区分不同 team。

### 2.3 当前最强的“team / account 容器”区分信号

可用字段：

- `accountId`，也就是 JWT 里的 `chatgpt_account_id`

证据：

- 当前代码会从 JWT 解析它，并在请求 `/backend-api/wham/usage` 时把它写入 `ChatGPT-Account-Id` header。
- 外部公开实现也普遍把它当成 ChatGPT / Codex account 标识来使用。

当前能安全说到哪一步：

- 它是当前链路里最强的“account / team 容器级区分字段”。
- 如果两条记录的用户字段相同，但 `chatgpt_account_id` 不同，那么当前可以把它们视为不同的 team / account 容器。
- 如果两条记录的 `chatgpt_account_id` 相同，而用户字段不同，那么当前可以把它们视为同一个 team / account 容器里的不同成员。

当前不能越界说的事：

- 不能把它直接等同于官方稳定的 `subscription_id`
- 不能证明它一定就是 billing 意义上的订阅唯一 id

## 3. `chatgpt_account_user_id` 当前能怎么用

字段：

- `accountUserId`，也就是 JWT 里的 `chatgpt_account_user_id`

当前可证据结论：

- 它比单纯用户 id 多了一层 account 上下文。
- 在当前观察里，它更像“某个用户在某个 account / team 容器里的成员级 id”。

适合做的事：

- 区分“同一个 team 下是不是同一个成员”

不适合做的事：

- 单独当成 team 唯一键
- 单独当成官方订阅唯一键

## 4. 当前不能可靠区分什么

以下字段都不能被当前项目安全地当成“订阅唯一标识”：

- `email`
- `planType`
- `chatgptPlanType`
- `chatgptUserId`
- `userId`
- `sessionId`
- `jwtId`
- `refresh`

原因：

- 它们要么是用户级字段
- 要么是登录态字段
- 要么只是套餐类别字段
- 都不是当前代码和公开证据里已被证实的订阅唯一 id

## 5. 当前最保守、最安全的识别规则

如果目标是“区分同一个人下面不同 team / account 容器”，当前建议规则是：

1. 先用 `sub` 或 `chatgptUserId / userId` 判断是不是同一个人
2. 在同一个人前提下，用 `chatgpt_account_id` 判断是不是同一个 team / account 容器
3. 如果 `chatgpt_account_id` 相同，再用 `chatgpt_account_user_id` 判断是不是同一个 team 里的同一个成员
4. 如果只是要区分不同登录态，再看 `access / sessionId / jwtId`

## 6. 当前硬限制

在这条 `auth + JWT + /wham/usage` 链路里，当前仍然没有被证实稳定可用的：

- `subscription_id`
- `team_id`
- `workspace_id`

所以当前应用：

- 能较准确地区分用户
- 能较准确地区分 team / account 容器
- 能区分同容器下不同成员
- 不能把这些判断上升为“已经拿到官方 billing 订阅唯一 id”
