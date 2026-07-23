# 创世引擎 · 神谕系统专项

> 状态：**v0.2 产品锁定**（开放问题已拍板，见 §9）  
> 日期：2026-07-23  
> 范围：多玩家归属、现实时钟、神谕点数与档位、非指向性波及、与推演 / Agent 的插入点  
> 依据：`创世契约.json`（神谕接收、干涉权限、演变过渡期、至高神谕）、`docs/backend-agent-architecture.md` §11.3  
> 非目标：化身 / 附身（已取消）；完整 UI 像素稿

---

## 0. 产品前提（已确认）

| # | 前提 | 说明 |
|---|------|------|
| P1 | **多用户** | 同一 `Run`（房间 / 存档）可有多名玩家 |
| P2 | **一人一文明** | 每位玩家绑定 **一个** 文明；神谕默认作用域 = 己方文明 |
| P3 | **观察者 + 神谕** | 不扮演、不附身任何领袖 / 关键人物；不发 `playerOrders` |
| P4 | **现实时钟** | **每现实 10 分钟 = 世界 1 年** |
| P5 | **神谕点数** | **每世界 50 年 = 1 点**（即每现实 500 分钟 ≈ 8h20m 积 1 点） |
| P6 | **开局赠点** | **3 点** |
| P7 | **暂停** | `paused` 时 **年不走、点不积** |
| P8 | **档位花费** | 1 / 2 / **3（A∥B∥C 三选一）** / 4 / 5，见 §3 |
| P9 | **非指向伤害** | **禁止**任何「指定他方文明为受害目标」的神谕效果；全域/自然力事件须对**所有文明**同规则抽检，见 §1.4 |

与《创世契约》对齐的硬原则（实现不得违反）：

- **神谕最高权限**：Agent 不得否决已生效的神谕补丁。  
- **过渡期**：默认**不立即**改写完毕；新规则与旧世界状态产生连锁（除非玩家标注「立即」且档位允许缩短）。  
- **英雄史观**：神谕落地后的叙事与大事记须挂到具体人物，禁止「文明抽象地遵旨」。  
- **至高神谕铁律**：演化仍须覆盖**所有文明**镜头；玩家神谕不豁免「只演我方」。  
- **公平波及**：神谕不得成为「点名制裁其他玩家文明」的武器（P9）。

---

## 1. 身份与房间模型

### 1.1 角色

```
Run（一场推演）
├── WorldClock              # 现实 → 世界年映射
├── Civ[]                   # 全文明（含无人认领的 NPC 文明）
├── PlayerSeat[]            # 玩家席位
│     playerId
│     civId                 # 绑定文明（一人一席；文明不可双绑）
│     oraclePoints          # 当前可用点数
│     oracleTimeGranted     # 按 50 年规则已发放次数（审计）
│     startingGrant         # 开局赠点（固定 3）
│     favorites[]           # 镜头收藏（不耗点）
│     role: 'owner' | 'member' | 'spectator'
└── EdictLedger[]           # 神谕流水
```

| 概念 | 规则 |
|------|------|
| 开局认领 | 创房时 / 加入时选择空闲文明；人数 ≤ 可玩文明数 |
| 无人文明 | 全程由 CharacterAgent + 规则 AI 运转；**不**产神谕点 |
| 换绑 | 默认禁止中途换文明（防点刷）；仅管理接口可例外 |
| 观察访客 | `spectator`：无点数、无神谕入口，只读 |

### 1.2 与旧「纯观察者」的关系

- **仍成立**：不附身、不直接下令国策执行细节。  
- **新增**：观察者挂在**自己的文明**上，用**点数购买**结构化干涉；不是全宇宙无代价的 `神喻：【】` 无限令。  
- **全局至高神谕**（契约原文「没有任何限制」）降级为：仅 `Run.flags.gmFreeOracle`（GM/单机调试）；**正式多人局默认关**。标准路径一律走点数档位 + P9。

### 1.3 作用域（Scope）

| 档位 | 默认可作用对象 | 波及规则 |
|------|----------------|----------|
| 1 国策/思潮 | 己方 `civId` | **仅己方**；文案若点名他方 → Validator 拒收或剥离他方语义 |
| 2 神物 | 己方仓储 / 己方关键人物 | **仅己方** |
| 3A 关键人物 | 己方 `Character` | **仅己方**；不可改他方人物面板 |
| 3B 外交姿态 | 己方对外**立场/条约意图** | **不**强制他方接受；他方 Agent 自由反应（见 §3.4B） |
| 3C 科技偏向 | 己方一条门槛/科技线 | **仅己方** |
| 4 创建事件 | 以己方为叙事主语，或**全域**自然/超凡现象 | 见 **§1.4**；**禁止** `targetCivIds` 式点名伤害 |
| 5 降下神谕 | 己方命运级改写 | 己方 patch 为主；若含灾变/法则级措辞，按 §1.4 升为**全域同检**，不得只砸他方 |

**禁止**（任意档位）：

- 修改他方玩家的 `oraclePoints`、绑席、未结算神谕队列。  
- **指向性伤害他方文明**（§1.4）。  
- 通过文案绕过结构化字段实现「只灭某某」。

### 1.4 铁律：禁止指向性伤害（P9）

> **定义**：神谕效果不得把**特定其他文明**（含其他玩家文明与 NPC 文明）指定为**唯一或优先受害对象**。

| 类型 | 是否允许 | 处理 |
|------|----------|------|
| 只改己方（国策、神物、己方人物、己方科技） | ✓ | 正常 |
| 己方获益、他方仅**间接**受竞争影响（市场、舆论） | ✓ | Resolver 自然推演，无 ForcedPatch 点名扣他方 |
| 「给某某降下瘟疫 / 天火 / 灭国」 | ✗ | **拒收**，退点 |
| 「全球瘟疫 / 小行星威胁 / 魔力潮汐」等**无点名**灾变 | ✓（4/5 档） | 对**每一个**文明（含发起者）按**同一规则表**抽检影响；发起者**不豁免** |
| 外交宣战、撕约 | 3B/4 有限 | **只改己方意图与公开姿态**；战争结果由双方 Agent + 棱镜结算，神谕**不**预写「某某必败」 |
| 「祝福全世界和平」类正向全域 | ✓ | 同规则作用于全文明 |

**Validator 要点**

1. 结构化字段：**删除** `targetCivIds` / `victimCivId` / `harmOnly` 等点名受害参数（正式多人 API 不暴露）。  
2. 自然语言 `seed` / `oracleText`：分类器或规则命中「点名 + 加害」→ `rejected` + 退点 + 提示改写为己方向或全域无点名。  
3. `kind: 'disaster'` 强制 `scope: 'global' | 'system' | 'body'`（地理/轨道范围），**禁止** `scope: 'civ'`。  
4. Resolver 对全域事件：先生成**与文明无关**的现象层 patch，再对每文明跑暴露度（位置、科技、体质…），**公式不读「是否玩家仇敌」**。

**反例 / 正例**

| 玩家输入 | 结果 |
|----------|------|
| 「给东陆联邦降下瘟疫」 | 拒收 |
| 「世界流行烈症」 | 接受（4 点+）；全文明暴露度结算，己方也可能重灾 |
| 「令西海帝国国库归零」 | 拒收 |
| 「吾民得丰饶之年」 | 接受（偏 4/5 己方向增益）；不自动扣他方 |
| 「与邻国开战且必胜」 | **整单倾向拒收**（含锁定胜负）；玩家应改为 3B「declare_hostility」不含必胜。若产品日后做「智能拆单」，须明示预览，默认不做静默剥离 |

---

## 2. 时间与点数经济

### 2.1 世界时钟

```ts
interface WorldClock {
  runId: string;
  realEpochMs: number;       // 现实 Unix ms（创建或上次解暂停校准）
  worldYearAtEpoch: number;  // 该时刻对应的世界年
  minutesPerYear: 10;        // 固定：10 现实分钟 = 1 世界年
  paused: boolean;           // true → 年不走、点不积
  speed: 1;                  // 预留；MVP 固定 1
}
```

**当前世界年（连续，未暂停时）**

\[
year = worldYearAtEpoch + \frac{now - realEpochMs}{10 \times 60 \times 1000}
\]

推演与编年用 `floor(year)`；UI 可显示本年内进度。

### 2.2 推进节奏（与 Orchestrator）

时钟驱动，不依赖「有人点推演」才过年：

| 节奏 | MVP | 说明 |
|------|-----|------|
| 年 tick | 每现实 **10 min** | 世界年 +1 |
| 轻量结算 | 每年 | 仓储、年龄、物流、过渡期进度 |
| 重推演 | 每 **N=5** 年或事件队列非空 | 现实约 50 min 一轮完整 Agent；可配置 |
| 神谕插入 | §4 | 已支付且到点 → 进入当轮 Drain |

**暂停（已锁定）**：`paused=true` 时 **年不走、点不积**。解暂停时重设 `realEpochMs` / `worldYearAtEpoch`，不补发暂停期间的点。

### 2.3 神谕点数获取

```ts
// 每位已绑定文明的玩家（非 spectator）：
// 开局 + startingGrant；之后每 50 个完整世界年 +1
// alreadyGranted 含开局赠点计入 life 审计时需区分：lifeFromTime 与 startingGrant 分字段
pointsFromTime = floor( (worldYear - yearAtBind) / 50 )
toGrant = pointsFromTime - oracleTimeGranted
```

| 规则 | 值（锁定） |
|------|------------|
| 基础产出 | 50 世界年 → **1 点** / 玩家 |
| **开局赠送** | **3 点** |
| 软顶 / 硬顶 | 软顶 10（UI 提示）；**硬顶 15**；`oraclePoints >= 15` 时时间产出 **到顶停积**（进度年仍走，解顶后不补发停积期间的点） |
| 暂停 | **不积年、不积点** |
| 退款 | 校验失败 / 撤销**未 resolving** 项 → 全额退点 |
| 已生效 | **不退** |
| 掉线 | 点数与队列保留在 `PlayerSeat` |

**现实时间换算**

| 世界 | 现实 |
|------|------|
| 1 年 | 10 分钟 |
| 50 年（1 点） | 500 分钟 ≈ **8 小时 20 分** |
| 开局 3 点 | 等价于「预支」约 150 年进度的操作空间 |

日常消耗应落在 1～3 点；5 点为重武器。

### 2.4 UX

- HUD：`神谕点数 n` + 下一滴倒计时（剩余世界年 / 现实时间）+ 暂停态。  
- `EdictLedger`：消费、拒收原因、效果摘要。  
- 无人文明 / spectator：无点数条。

---

## 3. 神谕档位与花费

### 3.1 总表

| 花费 | 代号 | 名称 | 玩家意图 | 系统效果摘要 |
|------|------|------|----------|--------------|
| **1** | `edict.policy` | 修改国策 / 思潮 | 调整己方长期取向 | `Civ.policy` / `Civ.ideology` 补丁；领袖 Agent 软对齐 |
| **2** | `edict.relic` | 赐予神物 | 给己方超常器物 | `Relic` → 帝国总仓或绑定己方人物 |
| **3** | `edict.tier3` | **三选一**（§3.4） | 中度干涉 | **A** 关键人物 / **B** 外交姿态 / **C** 科技偏向 |
| **4** | `edict.event` | 创建事件 | 插入有因果的事件 | `WorldEvent` → 棱镜；遵守 §1.4 |
| **5** | `edict.oracle` | 为文明降下神谕 | 己方命运级文本神谕 | 高优 patch + 过渡；灾变语义走全域同检 |

### 3.2 1 点 — 国策 / 思潮

```ts
{
  tier: 1,
  civId: string,              // = 玩家绑定
  target: 'policy' | 'ideology' | 'both',
  patch: {
    policy?: string,
    ideology?: string,
  },
  transitionYears?: number,   // 默认 5～20，校验钳制
  note?: string
}
```

**规则**

- 仅己方；点名加害 / 灭国语义 → 拒收。  
- 不瞬间改完全部军事部署；Agent 下轮置顶新国策。  
- `both`：**允许**一次同时改国策+思潮（仍 1 点）。

### 3.3 2 点 — 神物

```ts
{
  tier: 2,
  civId: string,
  relic: {
    name: string,
    nature: string,
    mechanicalTags: string[], // 白名单枚举
    bindTo?: 'empire' | characterId  // character 须己方
  },
  transitionYears?: number    // 默认 0～5
}
```

**规则**

- bonus / 故事钩，规则表封顶；无「灭世」标签。  
- 不可生成「专克某某文明」类定向词条。

### 3.4 3 点 — 三选一（A ∥ B ∥ C，已锁定）

一次提交 **只能选一个子类**，花费均为 **3 点**。

```ts
type Tier3Payload =
  | { sub: 'character'; /* A */ ... }
  | { sub: 'diplomacy'; /* B */ ... }
  | { sub: 'tech';      /* C */ ... };
```

#### 3.4 A — 改写关键人物 `sub: 'character'`

```ts
{
  tier: 3,
  sub: 'character',
  civId: string,
  characterId: string,        // 必须属己方
  ops: Array<
    | { op: 'stance'; value: string }
    | { op: 'motive'; value: string }
    | { op: 'status'; value: 'active' | 'exiled' | 'silent' | 'dead' | 'healed' }
    | { op: 'title'; value: string }
    | { op: 'ability_nudge'; name: string, delta: number }
    | { op: 'succession'; heirId: string }
    | { op: 'omen_bias'; actionPrefix: string, rounds: 1 | 2 }  // 天启软强制
  >,
  narrative: string,
  transitionYears?: number    // 默认 1～10
}
```

- 仅己方人物；禁止改他方面板。  
- 无叙事刷满全能力 → 拒收。  
- 「听见天启」最多软偏 1～2 轮 Agent，不写死战争结局。

#### 3.4 B — 外交姿态 `sub: 'diplomacy'`

```ts
{
  tier: 3,
  sub: 'diplomacy',
  civId: string,
  stance: {
    // 只表达己方对外意图，不写他方必然后果
    intent: 'seek_peace' | 'break_treaty' | 'declare_hostility' | 'open_trade' | 'isolate' | 'custom',
    toward?: 'all' | 'neighbors' | string,  // 若填具体 civId：仅作「己方对谁表态」，不扣对方 HP/国库
    publicReason: string,
    customText?: string
  },
  transitionYears?: number    // 默认 0～5（表态可较快）
}
```

**规则（与 P9 对齐）**

- 神谕只强制：**己方**公开姿态、条约意图、是否主动中止己方义务。  
- **不**强制他方停火、赔款、领土割让、领袖死亡。  
- 他方（玩家或 NPC）由 CharacterAgent 自行决定报复 / 媾和 / 无视；棱镜结算真实结果。  
- `declare_hostility` ≠ 预写胜负；禁止 payload 含 `mustWin` / `enemyCasualties`。

#### 3.4 C — 科技偏向 `sub: 'tech'`

```ts
{
  tier: 3,
  sub: 'tech',
  civId: string,
  tech: {
    trackId: string,          // 一条门槛科技或研究线，须属己方可研
    mode: 'accelerate' | 'focus_lock' | 'risk_unlock',
    years: number,            // 偏向持续时间，校验钳制如 10～50
    strength: '低' | '中'     // 禁止「瞬间满级」
  },
  narrative: string,
  transitionYears?: number
}
```

- 仅己方进度；不删除他方科技、不扩散瘟疫式「禁研」点名他国。  
- `focus_lock`：期内 Agent 高权重投该线，仍耗真实仓储/人力。

### 3.5 4 点 — 创建事件

```ts
{
  tier: 4,
  civId: string,              // 叙事主语 / 发起者标记（审计用）
  event: {
    title: string,
    seed: string,
    kind: 'internal' | 'disaster' | 'discovery' | 'diplomacy' | 'war_spark' | 'omen' | 'blessing',
    intensity: '低' | '中' | '高',
    // 禁止 victimCivIds / targetCivIds
    scope?: 'civ_self' | 'global' | 'system' | 'body',
    // civ_self：仅己方内部（政变、丰收、信仰涌现）
    // global/system/body：现象层无点名，全暴露度同检
  },
  transitionYears?: number
}
```

**流水线**：种子 → 结构化 `WorldEvent` → 校验 §1.4 → LensCritic → Resolver。  
**高强**强制过渡期。  
`kind: 'disaster'` 时 `scope` 不得为 `civ_self` 若语义是天灾（天灾必须 global/system/body）；纯「己方粮仓失火」可用 `internal` + `civ_self`。

`war_spark`：只点燃**己方**好战意图与边境摩擦叙事，不指定「灭谁」；双方后续由 Agent 接。

### 3.6 5 点 — 为文明降下神谕

```ts
{
  tier: 5,
  civId: string,
  oracleText: string,
  structuredIntent?: {
    goals: string[],          // 须可映射为己方向或全域无点名
    forbid?: string[],
    immediate?: boolean       // 缩短过渡，不跳过连锁与 §1.4
  }
}
```

**语义**

- 己方命运级：政体转向、举族迁徙、信仰维新、科技总纲、向某星进发等。  
- 解析为高优先级 patch + 多轮过渡；Agent 只可反应不可否决**已通过校验**的 patch。  
- 文案含「灭某某 / 只砸某某」→ **整单拒收**或自动改写失败则拒收（产品默认：**整单拒收退点**，避免静默篡改玩家原意）。  
- 文案含世界法则/全域灾变 → 升格 §1.4 全域同检，**发起者文明同样暴露**。  
- `immediate:true`：缩短过渡，**不**跳过棱镜与公平校验。

| 模式 | 谁 | 点数 |
|------|-----|------|
| 标准多人 | 各玩家 5 点档 | 耗 5 点；受 P9 |
| GM / 单机调试 | `gmFreeOracle=true` | 可不耗点；**仍建议**日志标记；正式局默认关 |

> 注：即使 GM 模式，若产品要求「绝对公平回放」，可仍启用 P9；调试旗标可另开 `gmBypassP9`（默认 false）。

---

## 4. 与推演流水线的插入点

```
现实时钟 year.tick
    │
    ├─ 若 paused：跳过年推进与积点
    ├─ 结算物流 / 年龄 / 过渡中 EdictEffect
    ├─ 发放神谕点（每 50 年，受硬顶）
    │
    └─ 若需重推演（每 N 年或队列非空）
           ▼
     Orchestrator.round
           ├─ 1. Drain EdictQueue（已支付、到点）
           │      → §1.4 再校验 → ForcedPatch + Agent 输入「天象」
           ├─ 2. 全部 CharacterAgent（各玩家文明不跳过）
           ├─ 3. LensCritic × 轮次
           ├─ 4. Resolver（神谕 patch 最高优先；全域事件同公式）
           ├─ 5. WorldBuilder 队列
           └─ 6. Chronicle + SSE
```

### 4.1 队列状态机

```
draft → paid(queued) → resolving → active(transition) → completed
                      ↘ rejected（退点）      // 含 P9 / 作用域失败
                      ↘ cancelled_by_player（未 resolving 前，退点）
```

### 4.2 API（草案）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/runs/:id/me` | 席位、点数、绑定文明 |
| GET | `/api/runs/:id/oracle` | 点数、下一滴、队列、暂停态 |
| POST | `/api/runs/:id/oracle` | 提交神谕 |
| POST | `/api/runs/:id/oracle/:eid/cancel` | 取消未生效 |
| GET | `/api/runs/:id/oracle/ledger` | 流水 |
| GET | `/api/runs/:id/events` | SSE：`year.tick` / `oracle.points` / `oracle.applied` / `oracle.rejected` / `round.*` |

```http
POST /api/runs/:runId/oracle
{ "tier": 1|2|3|4|5, "payload": { ... }, "dryRun"?: boolean }
→ { "edictId", "cost", "pointsLeft", "etaYear", "preview" }
→ 422 { "code": "P9_TARGETED_HARM" | "SCOPE" | "POOR" | ..., "message" }
```

`tier:3` 的 `payload.sub` 必填：`character` | `diplomacy` | `tech`。

旧 `POST /deduce { edict? }`：**拆分**为时钟自动推演 + 本 `oracle` API。

### 4.3 前端入口

- HUD：点数、世界年、下一滴、暂停。  
- 「降下神谕」向导：1 → 2 → **3 子类选择 A/B/C** → 4 → 5。  
- 4/5 档文案旁提示：**不可点名伤害其他文明；天灾将影响包括己方在内的所有文明。**  
- 推演控制台只读展示本轮天象来源。  
- 无附身入口。

---

## 5. 校验、公平与安全

| 层 | 内容 |
|----|------|
| 鉴权 | 仅本人花本人点；spectator 403 |
| 作用域 | §1.3 |
| **P9** | §1.4；命中则 `rejected` + 退点 |
| 频率 | 每人同时 `queued+active` ≤ 3 |
| 内容 | 注入过滤；文本长度上限 |
| 数值 | 神物 / ability_nudge / 科技加速封顶表 |
| 审计 | `EdictLedger`；Agent 只见合规摘要 |
| 冲突 | 同 tick 多神谕按支付时间序；全域事件合并为同现象层 |

---

## 6. 数据草图

```ts
interface PlayerSeat {
  playerId: string;
  runId: string;
  civId: string;
  oraclePoints: number;
  oracleTimeGranted: number;  // 仅时间产出已发放次数
  startingGrant: number;      // 开局固定 3
  yearAtBind: number;
  role: 'owner' | 'member' | 'spectator';
}

interface EdictRecord {
  id: string;
  runId: string;
  playerId: string;
  civId: string;
  tier: 1 | 2 | 3 | 4 | 5;
  sub?: 'character' | 'diplomacy' | 'tech';  // tier 3
  cost: number;
  payload: object;
  status: 'queued' | 'resolving' | 'active' | 'completed' | 'rejected' | 'cancelled';
  rejectCode?: 'P9_TARGETED_HARM' | 'SCOPE' | 'SCHEMA' | 'FUNDS' | 'RATE_LIMIT' | string;
  paidAtYear: number;
  activateAtYear: number;
  completeAtYear?: number;
  resultPatchIds?: string[];
  chronicleNodeIds?: string[];
}
```

---

## 7. 与主架构文档的衔接

| 主文档 | 状态 |
|--------|------|
| §11.3 神谕 | 由本文件 v0.2 锁定承接 |
| 推演触发 | 时钟 `year.tick` + 每 N 年重推演；`POST /oracle` 独立 |
| 无化身 | 不变 |
| 多人 `PlayerSeat` | 神谕前置依赖；阶段 D 部分前移 |
| WorldBuilder | 5 点 / 部分 4 点（发现类）可入队；仍受 P9 |
| 仓储两级 | 神物默认进帝国总仓 |

---

## 8. 验收标准（神谕专项）

1. 两名玩家绑定不同文明，点数独立；开局各 **3** 点。  
2. 10 现实分钟 → 世界 +1 年；每 50 年 +1 点；**暂停期间不加年、不加点**。  
3. 1～5 档扣点正确；3 档 A/B/C 互斥子类均可走通。  
4. 「给某某文明降下瘟疫」类提交 → `P9_TARGETED_HARM` 拒收并退点。  
5. 「世界流行烈症」→ 全文明暴露度结算，发起者可受害。  
6. 3B 宣战姿态不预写他方战败；棱镜后他方仍可反杀。  
7. 神谕 active 期间 Agent 不可否决合规 ForcedPatch。  
8. 过渡期分年变化；编年有人物主语。  
9. 未生效取消全额退点。  
10. 无人文明无神谕入口但出现在每轮镜头中。

---

## 9. 决议一览（终稿）

| # | 问题 | 拍板 |
|---|------|------|
| Q1 | 3 点档 | **A+B+C 均保留**，每次提交三选一子类 |
| Q2 | 开局赠点 | **3 点** |
| Q3 | 点数硬顶 | **15**（软顶 10 UI 提示） |
| Q4 | 重推演间隔 N | **5** 年（可配置） |
| Q5 | 暂停是否积点 | **否**（年与点均停） |
| Q6 | 波及他方 | **禁止指向性伤害**；全域事件全文明同规则；外交只改己方姿态 |
| Q7 | 正式多人 GM 免费神谕 | **默认关** |
| Q8 | 1 点 both 国策+思潮 | **允许** |
| Q9 | 5 点 immediate | **允许缩短过渡**，不跳过连锁与 P9 |
| Q10 | spectator | **要** |

---

## 10. 档位速查（实现/UI 文案）

| 点 | 一句话 |
|----|--------|
| 1 | 改写己方国策与/或思潮，带过渡年。 |
| 2 | 赐予己方一件有封顶的神物。 |
| 3A | 拨动己方一名关键人物（立场/存续/继承/天启软偏）。 |
| 3B | 强制己方外交姿态（和/撕约/敌意等），不写死他方结局。 |
| 3C | 加速或锁定己方一条科技线一段时间。 |
| 4 | 插入事件；天灾必须无点名且全文明同检。 |
| 5 | 己方命运级神谕；点名加害整单拒绝；法则灾变全域同检。 |

---

## 11. 任务书自查遗留（实现前可知，不阻 v0.2）

| # | 项 | 说明 | 建议默认 |
|---|-----|------|----------|
| G1 | 认证 / `playerId` | 本文不规定 OAuth/匿名房 | 实现阶段定；席位表已够 |
| G2 | 谁可暂停 | 未写死 | **仅 owner** |
| G3 | 中途入座 | `yearAtBind=入座年`，不补开局前 50 年点 | 已隐含；开局赠点仅首次绑定时发 3 |
| G4 | 服务停机追 tick | 重启后按 `realEpochMs` 一次追多年 | 单次追年上限（如 20）防雪崩，余量下一分钟继续 |
| G5 | 神物 `mechanicalTags` 枚举 | 未列全表 | 实现时白名单表；禁止伤害定向标签 |
| G6 | 过渡年精确表 | 仅给区间 | Validator 钳制区间即可，MVP 不随机 |
| G7 | 混合意图拆单 | 开战+必胜 | **整单拒收**（见 §1.4 正反例修订） |
| G8 | 与主文档路径 | 曾出现 `/edicts` vs `/oracle` | 以 **`/oracle`** 为准（主文档 v0.4 已对齐） |

---

*v0.2 锁定 + §11 自查遗留。实现时以本节编号回链 PR / Issue；修订须再产品确认。*
