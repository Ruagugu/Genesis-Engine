# 创世引擎 · 阶段 D 任务书：神谕系统

> 状态：**D0–D6 MVP 已落地** · 2026-07-25
> 产品锁定：[`edict-system.md`](./edict-system.md) v0.2
> 架构对齐：[`backend-agent-architecture.md`](./backend-agent-architecture.md) §7 阶段 D / §11.3
> 前置完成：阶段 C（Run 权威 · `POST deduce` · 无限骨架 · 设施上图 · hybrid TechDesigner · 六维 stats）
> 认证拍板：本地匿名 `playerToken`（localStorage），无 OAuth

---

## 0. 一句话

**阶段 D = 结构化神谕（1–5 档 + 3A/B/C）+ 点数经济 + P9 校验 + 时钟 Drain 入推演。**

席位、现实时钟、SSE 是神谕的**支撑件**（谁花钱、何时积点、前端如何感知），不是与神谕并列的另一条产品线。

---

## 1. 为什么要做（问题）

| 现状 | 问题 |
|------|------|
| 前端自由文本 → `runDeduction({ edict })` | 无点数、无档位、无队列、无过渡期 |
| 服务端只把文案塞进编年/棱镜 | Agent 与规则可「无视」神谕意图 |
| 示例鼓励「让东大陆沉没 / 三年大旱」 | 与 **P9 禁止点名伤害** 正式规则冲突 |
| Snapshot `clock.paused: true` 写死 | 无现实时钟、无积点 |
| Run 无 `seats` | 无法回答「谁的 3 点」 |

文档早已把神谕留给 D（`phase-c-deduce-universe.md` §9）；`edict-system.md` v0.2 已产品锁定，本任务书只做**可实施拆解**，不重开产品决议。

---

## 2. 产品契约（实现不得改）

来源：`edict-system.md` v0.2 §0 / §9。

| # | 契约 | 值 |
|---|------|-----|
| P1 | 多用户 | 同一 Run 可多名玩家 |
| P2 | 一人一文明 | `PlayerSeat.civId` 唯一；默认不可换绑 |
| P3 | 观察者 + 神谕 | 不附身、不发 `playerOrders` |
| P4 | 现实时钟 | **10 现实分钟 = 1 世界年** |
| P5 | 积点 | **每 50 世界年 = 1 点** |
| P6 | 开局赠点 | **3 点** |
| P7 | 暂停 | `paused` → **年不走、点不积** |
| P8 | 档位花费 | 1 / 2 / **3（A∥B∥C 三选一）** / 4 / 5 |
| P9 | 非指向伤害 | **禁止**指定他方文明为受害目标；全域事件全文明同规则抽检 |
| — | 点数硬顶 | **15**（软顶 10 仅 UI 提示） |
| — | 重推演间隔 N | **5** 世界年（可配置） |
| — | 正式局 GM 免费神谕 | **默认关** |
| — | spectator | **要**（无点、无神谕入口） |

铁律摘要：

- 神谕 patch **高于** Agent，已生效不可否决。
- 默认带**过渡期**，不瞬间改完世界。
- 编年必须挂**人物主语**（英雄史观）。
- 每轮推演仍覆盖**所有文明**镜头；神谕不豁免「只演我方」。

---

## 3. 与阶段 C 的边界

| 保留（C） | 替换 / 新增（D） |
|-----------|------------------|
| `POST /api/v1/runs/:id/deduce` 真推演内核 | 自由文本 `body.edict` **不再**是正式神谕主路径 |
| `agentMode` / LLM / designQueue / stats / 星图门控 | 独立 `POST …/oracle`；Deduce **Drain** 已支付神谕 |
| Run JSON 持久化 + `withDeduceLock` | 扩展 `clock` / `seats` / `edicts` / `oracleLedger` / `flags` |
| 前端 `?mockDeduce=1` 调试 | 神谕 UI 改为档位向导；旧「所言即成真」仅 `gmFreeOracle` |

```
正式路径：  claim 席位 → 花点 POST /oracle → 校验(P9) → 队列
                → 时钟 tick / 手动或自动 deduce
                → Drain ForcedPatch（最高优先）→ 既有 C 管线
```

---

## 4. 目标架构

```
PlayerSeat (playerToken → civId, oraclePoints)
         │
         ▼
POST /oracle ──► Validator(schema + scope + P9)
         │              │ reject → 全额退点 + ledger
         ▼              ▼
    EdictQueue        OracleLedger
         │
WorldClock.year.tick ──► 积点 / 过渡进度
         │               每 N=5 年或队列 due
         ▼
Orchestrator / deduce
  1. ensureClock + grant points
  2. Drain EdictQueue → ForcedPatch + 天象摘要
  3. Character 决策（全文明，含无人席；只读天象）
  4. Lens + Resolver（神谕 patch 不可被盖掉）
  5. WorldBuilder / tech / stats（既有 C）
  6. Chronicle + SSE
```

---

## 5. 数据模型（Run 扩展）

向后兼容：旧存档缺字段时加载补默认。

```ts
// Run 新增 / 规范化
clock: {
  realEpochMs: number;          // 现实校准点
  worldYearAtEpoch: number;     // 该点对应世界年（可小数冻结）
  minutesPerYear: 10;
  paused: boolean;              // 默认 true（单机开局先暂停，避免后台偷跑）
  speed: 1;                     // MVP 固定 1
  lastTickAt?: number;
  yearsSinceRound?: number;     // 距上次重推演的累计年
}

seats: Array<{
  playerId: string;             // = playerToken
  runId: string;
  civId: string | null;         // spectator 为 null
  displayName?: string;
  role: 'owner' | 'member' | 'spectator';
  oraclePoints: number;
  oracleTimeGranted: number;    // 时间产出已发放次数（审计）
  startingGrant: number;        // 开局 3
  yearAtBind: number;
  claimedAt: string;
}>

edicts: EdictRecord[]           // 见 edict-system §6
oracleLedger: Array<{
  id: string;
  at: string;                   // ISO
  year: number;
  kind: 'grant' | 'spend' | 'refund' | 'reject' | 'apply' | 'cancel';
  summary: string;
  seatPlayerId?: string;
  edictId?: string;
  deltaPoints?: number;
}>

flags: {
  gmFreeOracle?: boolean;       // 默认 false
}
```

Snapshot：`clock` 改为真实字段（不再写死 `paused: true`）；可附带 `seatsPublic`（占席文明，**不**下发 token）。

---

## 6. API 一览

认证：`X-Player-Token` Header，或 query/body `playerToken`。

| 方法 | 路径 | 说明 | 里程碑 |
|------|------|------|--------|
| POST | `/api/v1/runs/:id/seats/claim` | `{ playerToken, civId, displayName? }` 认领 | D1 |
| POST | `/api/v1/runs/:id/seats/spectate` | 观察者入座（可选） | D1 |
| GET | `/api/v1/runs/:id/me` | 我的席位 / 点数 / 绑定文明 | D1 |
| GET | `/api/v1/runs/:id/seats` | 公开占席列表（无 token） | D1 |
| GET | `/api/v1/runs/:id/oracle` | 点数、下一滴、队列、paused | D3 |
| POST | `/api/v1/runs/:id/oracle` | 提交神谕；支持 `dryRun` | D3 |
| POST | `/api/v1/runs/:id/oracle/:eid/cancel` | 未 resolving 全额退点 | D3 |
| GET | `/api/v1/runs/:id/oracle/ledger` | 流水 | D3 |
| POST | `/api/v1/runs/:id/clock/pause` | `{ paused }` 仅 owner | D2 |
| POST | `/api/v1/runs/:id/clock/advance` | `{ years }` **测试钩子**快进 | D2 |
| GET | `/api/v1/runs/:id/events` | SSE | D5 |
| POST | `/api/v1/runs/:id/deduce` | 保留；开头 Drain 神谕 | D3 改 |

`POST /oracle` 响应：

```jsonc
// 200
{ "edictId", "cost", "pointsLeft", "etaYear", "status", "preview" }

// 422
{ "error": "P9_TARGETED_HARM" | "SCOPE" | "SCHEMA" | "FUNDS" | "RATE_LIMIT" | "NO_SEAT", "message" }
```

健康检查：`phase: 'D'`；`writeAllow` 增加 seat / oracle / clock 路径。

---

## 7. 档位 → ForcedPatch（实现要点）

| 点 | 代号 | 程序效果（优先，不依赖 LLM） | 校验要点 |
|----|------|------------------------------|----------|
| **1** | policy / ideology | 写己方 `目前国策` / `思潮`；`持续年数` 重置；过渡年 5～20 | 仅己方；点名灭国语义拒收 |
| **2** | relic | `civ.relics[]` + 小幅 stats（白名单 tags，封顶） | 禁止「专克某某」标签；绑定人物须己方 |
| **3A** | character | stance / motive / status / title / ability_nudge / succession / omen_bias | 人物必须属己方；无叙事刷满能力 |
| **3B** | diplomacy | 仅己方对外 intent / 公开姿态；可写 relation 己方侧叙述 | **禁止** mustWin / 敌方伤亡预写 |
| **3C** | tech | 己方 `techFocus` / 研究加速 flag，年限钳制 | 不删他方科技 |
| **4** | event | `WorldEvent` 入队；disaster → 全域暴露度表 | scope ≠ 点名 civ；发起者**不豁免** |
| **5** | oracle | 高优己方命运 patch + 多轮过渡；文案过 P9 | 点名加害 **整单拒收退点**；法则灾变升全域同检 |

队列状态机：

```
draft → paid(queued) → resolving → active(transition) → completed
                   ↘ rejected（退点）
                   ↘ cancelled（未 resolving，退点）
```

并发：每人同时 `queued+active` ≤ 3。

---

## 8. P9 校验清单（实现）

1. 结构化字段：**不暴露** `targetCivIds` / `victimCivId` / `harmOnly`。
2. 自然语言 `seed` / `oracleText`：命中「点名文明名|短名 + 加害动词（灭/屠/瘟疫专降/国库归零…）」→ `P9_TARGETED_HARM`。
3. `kind: 'disaster'` → `scope ∈ { global, system, body }`。
4. Resolver 全域事件：先现象层，再对**每一文明**同公式暴露度（可读稳定/科技；**不读**「是否仇敌」）。
5. 3B `declare_hostility` ≠ 预写胜负。

正反例直接用 `edict-system.md` §1.4 表，QA 语料从中抽取。

---

## 9. 时钟与积点

连续年（未暂停）：

\[
year = worldYearAtEpoch + \frac{now - realEpochMs}{minutesPerYear \times 60 \times 1000}
\]

| 规则 | 行为 |
|------|------|
| 年 tick | floor 年前进时触发轻量逻辑；编年用 floor |
| 积点 | 每席 `floor((year - yearAtBind)/50) - oracleTimeGranted`；硬顶 15 到顶停积且**不补发** |
| 暂停 | 冻结 `worldYearAtEpoch`；解暂停重设 `realEpochMs` |
| 停机追 tick | 单次最多 +20 年，余量下轮（G4） |
| 重推演 | `yearsSinceRound ≥ 5` 或神谕 due → 可自动 deduce（建议默认 `rules_only`） |
| 惰性 tick | **每次**相关 API 读/写先 `ensureClock`+`tick`；可选 30～60s interval 双保险 |
| UI 启停 | 顶部播放键与神谕向导「开始走时/暂停世界」控制服务端 WorldClock；旧前端 autoDeduce 仅作调试节拍 |

谁可暂停：**仅 owner**（edict G2 默认）。

---

## 10. 里程碑与任务拆解

### D0 — 契约与数据壳

**目标**：文档 + Run 字段，不改玩法体感。

- [ ] 本任务书定稿（本文）
- [ ] `run-store`：创建/加载时 `ensurePhaseDFields`（clock/seats/edicts/ledger/flags）
- [ ] `toSnapshot` 输出真实 `clock`；`notes.phase = 'D'`
- [ ] `GET /health` → `phase: 'D'`，writeAllow 预留

**交付物**：旧 Run 仍能 deduce；新字段默认安全（paused、空席）。

---

### D1 — 席位与匿名 token

**目标**：神谕「谁在花钱」有主体。

- [ ] `server/seat-service.mjs`：claim / me / spectator / 查重
- [ ] `POST …/seats/claim`、`GET …/me`、`GET …/seats`
- [ ] 首个非 spectator claim → `owner` + 开局 **3** 点；`yearAtBind = floor(year)`
- [ ] 文明已占 → 409；同 token 同 civ 幂等；禁止换绑
- [ ] 前端：启动生成并持久化 `playerToken`；认领 UI（或设置页选文明）

**不做**：OAuth、中途换绑、真实账号。

---

### D2 — WorldClock + 积点

**目标**：神谕经济发动机。

- [ ] `server/clock-service.mjs`：`continuousYear` / `tick` / `setPaused` / `advanceYears` / `grantOraclePoints`
- [ ] 相关 API 入口惰性 tick
- [ ] `POST …/clock/pause`（owner）
- [ ] `POST …/clock/advance`（QA/调试快进；正式 UI 可隐藏）
- [ ] 积点写 `oracleLedger`（kind: grant）
- [ ] （可选）`yearsSinceRound ≥ 5` 自动 rules_only deduce + 与 `withDeduceLock` 共用

---

### D3 — oracle-service 核心 ⭐ 主交付

**目标**：结构化神谕可花、可拒、可进推演。

- [ ] `server/oracle-service.mjs`
  - Schema：tier 1–5、tier3 `sub` 互斥、长度上限
  - P9 文本 + 结构
  - 扣点 / 退点 / 队列状态机 / 人均并发 ≤ 3
  - ForcedPatch 生成（上表）
  - `dryRun` 只预览不扣点
- [ ] API：GET/POST oracle、cancel、ledger
- [ ] `deduce` **最前** `drainEdicts`：
  - status → resolving → 应用 patch → active/completed
  - 写入 chronicle 天象（挂人物）
  - 决策上下文只读 omen，**不得**覆盖 ForcedPatch
- [ ] 废弃前端主路径自由文本 edict；`gmFreeOracle` 单独门（默认关，仍建议过 P9）

**建议实现序（D3 内）**：
1 → 3A / 3C（纯己方程序）→ 3B / 2 → 4 全域同检 → 5 + 强 P9 语料。

---

### D4 — 前端神谕向导 + HUD

**目标**：玩家按档位花钱，不再「一言改宇宙」。

- [ ] 替换 `panels.openEdict` 无限令 → 档位向导（1→2→3A/B/C→4→5）
- [ ] 4/5 固定提示：**不可点名伤害其他文明；天灾含己方**
- [ ] HUD：点数、下一滴（世界年/现实估时）、暂停、绑定文明
- [ ] 推演控制台展示本轮 `oracle.applied`
- [ ] 认领席位入口
- [ ] 文案从「所言即成真」改为「点数购档 · 合规神谕」

---

### D5 — SSE 最小集

**目标**：神谕与年 tick 可感知，无需整页刷新。

- [ ] `GET …/events?playerToken=`（SSE）
- [ ] 事件：`year.tick` / `oracle.points` / `oracle.applied` / `oracle.rejected` / `round.progress`（可选 `body.added`）
- [ ] 前端 EventSource；断线拉 snapshot
- [ ] **不做**：战斗锁步、完整帧同步

---

### D6 — QA 与验收

对齐 `edict-system.md` §8。

| # | 用例 | 期望 |
|---|------|------|
| 1 | 两 token 领不同文明 | 各 3 点，互不花对方点 |
| 2 | `clock/advance` 50 年 | +1 点；pause 期间 advance 策略在实现时写死（建议钩子仍推进，真实 tick 尊重 pause） |
| 3 | 真实 tick + pause | 年与点双停 |
| 4 | tier 1–5 与 3A/B/C | 各 ≥1 happy path |
| 5 | 「给dawn降下瘟疫」 | `P9_TARGETED_HARM` + 退点 |
| 6 | 「世界流行烈症」 | 全文明暴露，发起者可受伤 |
| 7 | 3B 宣战 | 无 mustWin；他方仍可反制 |
| 8 | 神谕 active | 随后 deduce 不抹掉 ForcedPatch |
| 9 | cancel 未生效 | 全额退点 |
| 10 | 无人文明 | 无神谕入口，仍出现在 deduce 镜头 |
| 11 | 回归 | 阶段 C deduce / tech / 星图门控 QA 全绿 |

测试文件建议：`qa/oracle.spec.mjs`、`qa/clock-seats.spec.mjs`。

---

## 11. 关键文件（预期）

| 动作 | 路径 |
|------|------|
| 新 | `docs/phase-d-oracle.md`（本文） |
| 新 | `server/seat-service.mjs` |
| 新 | `server/clock-service.mjs` |
| 新 | `server/oracle-service.mjs` |
| 改 | `server/run-store.mjs` — 字段迁移、snapshot clock |
| 改 | `server/api.mjs` — 路由白名单、惰性 tick |
| 改 | `server/deduce-engine.mjs` — Drain 最前；弱化自由 edict |
| 改 | `js/panels.js` — 神谕向导 |
| 改 | `js/main.js` — token、HUD、SSE、认领 |
| 改 | `js/snapshot.js` — clock 真实字段 |
| 新 | `qa/oracle.spec.mjs` 等 |

**复用**：`applyIdeology`、`tickTechProgress` 加速钩子、`mergeCivPatches`、`withDeduceLock`、编年挂人名、既有 civ stats。

---

## 12. 推荐执行顺序

```
D0 文档+字段
 → D1 席位 token          （否则点数无主）
 → D2 时钟积点            （可 advance 测）
 → D3 神谕 1→3→5 渐进     ⭐
 → D4 UI（可与 D3 后半并行）
 → D5 SSE
 → D6 QA 全绿 = 阶段 D Done
```

原则：**神谕主路径优先于 SSE 美化**；自动 hybrid 重推演不要默认打开（latency）。

---

## 13. 风险与对策

| 风险 | 对策 |
|------|------|
| hybrid 一轮数十秒 vs 时钟自动推演 | 自动 round 默认 `rules_only`；ForcedPatch 程序化 |
| 自由文本绕过 P9 | 正式路径强制结构化；4/5 的 NL 只作 seed + 规则分类器 |
| 单进程丢 tick | 惰性 ensureClock 每次 API；追年封顶 20 |
| 旧「所言即成真」预期 | UI 文案与向导教育；GM 旗标单独说明 |
| 多席并发 deduce | 已有 `withDeduceLock`；oracle 支付与 Drain 同 run 锁 |
| 停机补发点 | 硬顶停积不补发；pause 不积 |

---

## 14. 明确不在阶段 D

- Surface 分片 tiles
- 跨星物流完整延迟 / 设施战斗迷雾
- 镜头刷远景「无限星海背景」
- OAuth / 真实账号 / 付费
- 化身 / 附身（已取消）
- 生产级 OpenAPI 网关与完整锁步

---

## 15. 验收一句话

**玩家认领文明后，用开局 3 点按 1–5 档降下合规神谕；点数随现实时钟积攒；点名伤害被拒并退点；生效补丁进入推演且 Agent 不可否决；HUD（及 SSE）能看见点与年。**

---

## 16. 开放实现细节（不阻开工，实现时写死）

| # | 项 | 建议默认 |
|---|-----|----------|
| G1 | playerToken 熵 | `ge_` + 24 字节 hex |
| G2 | 谁可 pause | 仅 owner |
| G3 | 中途入座赠点 | 仅 startingGrant=3，不补历史 50 年点 |
| G4 | 追 tick 上限 | 20 年/次 |
| G5 | 神物 mechanicalTags | 小白名单；禁伤害定向 |
| G6 | `clock/advance` 是否绕过 pause | **是**（测试钩子）；文档标明 |
| G7 | 自动重推演 agentMode | `rules_only` |
| G8 | 旧 `deduce { edict }` | 忽略或仅 gm 旗标；QA 不再依赖 |

---

## 17. 审阅清单（给你打钩）

请确认或批注：

- [ ] 同意 **神谕为 D 中枢**，席位/时钟/SSE 为支撑
- [ ] 同意认证用 **匿名 playerToken**
- [ ] 同意正式路径 **废除自由文本无限令**（GM 另开）
- [ ] 同意里程碑顺序 D0→D1→D2→D3⭐→D4→D5→D6
- [ ] 同意自动重推演默认 **rules_only**
- [ ] 档位 MVP 是否必须 **1～5 全开**，还是先 1+3A+3C+5 再补 2/3B/4？
- [ ] 单机开局 clock 默认 **paused=true**（需玩家/owner 解除）还是 **false 直接走时**？

---

*本文为阶段 D 实施任务书。产品语义冲突时以 `edict-system.md` v0.2 为准；实施排序与工程边界以本文为准。*
