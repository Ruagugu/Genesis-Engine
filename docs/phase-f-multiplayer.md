# 阶段 F · 多人同局体验 v1（实时收敛）

状态：**F0–F5 已落地** · 2026-07-27
上游：`backend-agent-architecture.md` §7 阶段 D/E、`phase-e-genesis-start.md`
分支：`feat/phase-f-multiplayer`

## 1. 目标

阶段 E 之后，多账号已经可以在同一 run 各建一文明，但**同局的其他客户端看不到彼此的动作**：
前端 SSE 只消费时钟/神谕类事件（`ready` / `year.tick` / `clock.pause` / `oracle.*` / `round.*`），
`civ.created` / `civ.enriched` / `civ.settled` / `seat.claimed` 服务端在广播、前端无人接；
`round.done` 只刷神谕 HUD，观察端的文明数据 / 编年 / 推演日志全部停留在开局快照。

本阶段做**体验验证 + 实时收敛**：两名玩家同看一局时，建文明、落地、年结算在双方页面上
无刷新收敛；并用双 browser context 的 QA 用例把这条链路钉死。

不做（后续阶段）：真人聊天 / 外交、席位转让、断线重连补帧（依赖 revision 拉快照已覆盖）、
逐 tile 的疆域增量广播（沿用 territorySeed + 意图收敛的既有契约）。

## 2. 契约

### F-P1 SSE 载荷扩充（服务端）
- `civ.created`：原 `{civId, name, by}` 基础上追加 `civ`（完整文明对象）与 `seat`。
- `civ.enriched`：追加 `fields`（civ 文本字段补丁）与 `leaderFields`（`{background?, motive?}`）；
  `genesis-service.enrichCivWithLlm` 返回值同步扩为 `{ok, applied, fields, leaderFields}`。
- `civ.settled`：追加 `landing = {surfaceId, tileId, lat, lon, year}`；
  `settleCiv` 返回值追加 `landing`。

### F-P2 前端实时合并（幂等）
- `civ.created`：本地无同 id 文明才 push（操作者本机已推入，回声跳过）；刷新文明 dock；toast。
- `civ.enriched`：按 id 找到文明，`Object.assign` 合并 `fields` / `leaderFields`（领袖取 `leaders[0]`）。
- `civ.settled`：以 `civ.territorySeed` 已存在判定「本机操作者」，操作者回声只补 `landing` 记录；
  远端客户端写 `capital` / `territorySeed` / `landing`，若当前正看 `gaiya:surface` 则并入
  `capitalSeeds` / `claimRadius=4`、对无主地块 `setTileOwner(claimSource:'landing')` 并重建战略层；
  不在盖亚时仅存种子，依赖既有 territorySeed 引导收敛。
- `seat.claimed`：刷新神谕 HUD。

### F-P3 round.done 观察端收敛
- `round.done` 载荷含 `revision`；前端若 `revision > GE.snapshot.last.revision` 则拉
  `GET /runs/:id/snapshot` 做**选择性合并**（禁止 `applyToData` 整体替换，避免打断
  `worldState.def` 活引用）：
  - 直接替换：`world`、`civs`、`chronicle`、`thresholds`、`favorites`、`relations`、`legacies`、`deduction`；
  - 并入活对象：各 `bodySurfaces[sid]` 的 `capitalSeeds` / `claimRadius`（同时并入当前 `worldState.def`）;
  - `spaceBodies` 只增不换（新天体按 parent/home 映射后 push）；
  - 同步 `state.simulatedYear` / 世界条 / 文明 dock / 推演控制台轮次；`GE.snapshot.last = 新快照`。
- 本机主动推演合并完成后写 `GE.snapshot.last.revision = result.revision`，抑制自身回声重复拉取。
- 并发保护：收敛进行中忽略后续触发（单飞行标志）。

### F-P4 同局在场
- 账号面板（登录态）追加「同局玩家」区块：`GET /runs/:id/seats` 列 displayName / 角色 / 文明名。

### F-P5 时钟按钮回滚
- 顶栏播放键乐观切换后若服务端拒绝（member 403 等），回滚 `state.playing` 与按钮视觉，
  保留警告 toast。

## 3. QA（qa/multiplayer.spec.mjs · 双 context）

1. A 页面在线（SSE 已连）→ B 经 API 注册+建文明 → A 无刷新出现新文明（dock / GE.data.civs）。
2. B 经 API 落地合法地块 → A 无刷新收敛：地块 ownerCivId、capitalSeeds、capital 文案。
3. A（owner 席位）可启停时钟；B（member）启停被拒且 A 页按钮状态回滚正确。
4. A 打开账号面板见「同局玩家」两行（A、B 的 displayName）。
5. 手动触发一轮推演 → 观察端 revision 收敛（年数 / 编年增长，无刷新）。

回归约束：既有 86 用例全绿；`workers:1` 串行不变。

## 4. 里程碑

- [x] F0 本任务书
- [x] F1 服务端 SSE 载荷扩充（F-P1）
- [x] F2 前端创世事件实时合并（F-P2）
- [x] F3 round.done 快照收敛（F-P3）
- [x] F4 同局玩家列表（F-P4）+ 时钟回滚（F-P5）
- [x] F5 QA `qa/multiplayer.spec.mjs` 2 用例 + 全量回归 88/88 绿 + 合入 main

实现备注：
- QA 以「A 页面在线 + B 走 API」验证实时收敛（等价于双 context 且更稳）；
  年结算收敛用匿名观察者页面验证。
- `runDeduction` 本机合并后已写 `snapshot.last.revision`（阶段 C 既有），
  操作者对自身 round.done 回声天然免疫，无需额外去抖。
