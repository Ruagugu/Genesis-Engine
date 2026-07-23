# 创世引擎 · 后端与 Agent 架构

> 状态：设计草案（**v0.4**）— §11 拍板；神谕锁定见 `edict-system.md` v0.2；§5.6/§6 已与时钟推演对齐  
> 日期：2026-07-23  
> 范围：多星球战略地图、宇宙补全、领袖 / 关键人物 Agent、推演与 API、多玩家席位（与神谕衔接）  
> 依据：`创世契约.json`、`docs/edict-system.md`、`js/data.world.js`、`js/world-state.js`、`js/world-grid.js`、`js/view.planet.js`、`js/view.universe.js`、`js/main.js`、`js/panels.js`

---

## 0. 目标与硬约束

### 0.1 本阶段要解决的三点

| # | 现状（前端原型） | 目标 |
|---|------------------|------|
| 1 | 星球视图**写死为母星盖亚**：`home:true` 才能进入；`strategicMap` / `worldState` 全局单例 | **任意可登陆天体**都有独立星球层面地图（网格、地形、归属、仓储） |
| 2 | 宇宙只有**单一参考星系「曦阳」**的静态 `spaceBodies` | API + Agent 在推演中**按需补全**星球地形与更多星系 / 天体 |
| 3 | 领袖有 `isAgent` / `agentModel` / `agentStance`，推演是前端 Mock | 真实 **Agent 运行时**：适配领袖与关键人物，决策 → 多棱镜 → 世界收敛 |

### 0.2 与《创世契约》对齐的原则

- **英雄史观**：事件必须挂到具体人物（领袖 / 关键人物），禁止「文明抽象地做了某事」。
- **编年体 + 小说体**：大时间跨度用节点编年；锁定个体时切微观场景。
- **MVU 变量更新**：世界状态以结构化变量为准，推演结果以补丁（patch）形式落库。
- **神谕最高权限**：合规神谕 patch 强制改写；Agent 不得否决（点数档位与 P9 见 `edict-system.md`）。
- **铁律（至高神谕）**：每轮演化须覆盖**所有文明**的变化与镜头；种族特殊个体可注但不可忽略群体。

### 0.3 非目标（本草案不展开）

- 完整帧同步 / 战斗锁步等重度实时协议（房间 + SSE 增量即可）。
- 黑洞视图物理求解器改造。
- 前端视觉重做。
- 神谕 UI 像素稿与文案分类器训练细节（规则 + 接口在神谕专项）。

---

## 1. 现状快照与缺口

### 1.1 数据层

```
GE.data
├── world            # 单世界元数据，含「母星名」
├── civs[].leaders[] # 含 isAgent / agentModel / agentStance / personality / motive
├── spaceBodies[]    # 曦阳星系静态天体；仅 gaiya.home=true
├── strategicMap     # 全局一份：topology + regions + capitalSeeds…
├── deduction        # lenses / pendingDecisions / log（Mock）
└── …
GE.worldGrid         # 基于 strategicMap.topology 的确定性网格（单例）
GE.worldState        # 基于 strategicMap 的地块 / 仓储（单例，localStorage）
```

### 1.2 视图层硬编码点（必须拆除）

| 位置 | 问题 |
|------|------|
| `spaceBodies` 中 `home:true` | 语义混用「玩家出生星」与「可进入星球」 |
| `view.universe` 双击 / `showBodyCard` | 仅 `body.home` 可 `switchView('planet')` |
| `view.planet` + `worldState` | 只服务盖亚一套网格与染色 |
| `main.js` HUD `ws-planet-name` | 固定 `world.母星名` |
| `panels.openPlanetInfo` | 文案写死盖亚 |

### 1.3 推演层

- 流水线 UI 已有：决策提交 → 多棱镜 → 世界收敛 → 编年入册。
- `runDeduction` 为本地假数据 + `worldState.advanceTurn()`，无 LLM、无人物级决策生成。

---

## 2. 领域模型（Canonical Domain）

以下为后端权威模型。前端 `GE.data` 逐步改为「会话快照 + 懒加载切片」。

### 2.1 层级

```
UniverseRun（一场推演存档 / 房间）
├── WorldClock                  # 现实 10min = 世界 1 年；paused
├── PlayerSeat[]                # 一人一文明；oraclePoints；spectator
├── EdictLedger[]               # 神谕流水（见 edict-system.md）
├── Galaxy[]                    # 星系（种子阶段可只有曦阳）
│   └── StarSystem
│       └── Body[]              # 恒星 / 行星 / 卫星 / 带 / 站 / 黑洞…
│           └── PlanetSurface?  # 仅可登陆体拥有
│               ├── Topology    # frequency 模型自拟 ∈{8,16,32,64}
│               ├── TileState[] # 变更补丁
│               ├── Region[]
│               └── Warehouse[] # 行星仓 civId+surfaceId
├── Civ[]
│   ├── Character[]             # 领袖 + 关键人物（Agent 主体）
│   └── Warehouse@empire        # 帝国总仓 civId
├── Chronicle / Legacies / Favorites / Relations
└── DeductionRound[]
```

### 2.2 天体 `Body`

```ts
type BodyKind =
  | '恒星' | '类地行星' | '岩质行星' | '气态巨星' | '冰巨星'
  | '矮行星' | '卫星' | '小行星带' | '空间站' | '黑洞';

interface Body {
  id: string;                 // 稳定 ID，如 gaiya / sys-02-p3
  galaxyId: string;
  systemId: string;
  name: string;
  kind: BodyKind;
  subtype?: string;
  color: string;
  radiusVisual: number;       // 前端渲染尺度
  orbit?: OrbitParams;        // null = 中心恒星
  parentBodyId?: string;      // 卫星 / 站
  ring?: boolean;
  desc?: string;

  // —— 取代单一 home 布尔 ——
  flags: {
    isPlayerHome?: boolean;   // 玩家开局母星（叙事）
    landable: boolean;        // 是否可进入星球地图
    colonized?: boolean;
    surveyed: SurveyLevel;    // none | remote | orbital | surface
  };

  // 表面尚未生成时为 null；生成后指向 PlanetSurface 摘要
  surfaceId?: string | null;
  surfaceSeed?: number;       // 确定性地形种子
  climateProfile?: ClimateProfile; // 供生成器用
}
```

**规则**

- `landable === true` 的天体均可进入星球视图（类地、部分岩质 / 冰冻卫星、已改造气巨卫星等）。
- `isPlayerHome` 仅影响叙事与默认相机，**不再**作为进入星球的条件。
- 未 `surveyed` 到 `surface` 的 landable 体：可进入，但地图为「未知 / 雾」或触发勘察生成任务。

### 2.3 星球表面 `PlanetSurface`

```ts
interface PlanetSurface {
  id: string;                 // 通常 = bodyId 或 bodyId + ':surface'
  bodyId: string;
  schemaVersion: number;
  topology: {
    kind: 'icosahedron-dual';
    frequency: number;        // 模型自拟，∈{8,16,32,64}，写时固定
    seed: number;             // 与 body.surfaceSeed 对齐
    planetRadiusKm: number;
    nominalTileWidthKm: number;
  };
  regions: RegionDef[];
  terrainCatalogRef: string;  // 可多星球共用目录，或覆盖
  resourceCatalogRef: string;
  buildingCatalogRef: string;
  capitalSeeds: Record<CivId, LatLon>;
  claimRadius: Record<CivId, number>;
  // 运行时地块不进全量 JSON：见 TilePatchStore
}
```

**生成策略**

| 阶段 | 内容 | 触发 |
|------|------|------|
| L0 轨道参数 | 已有 `Body` | 开局种子 / **推演中 WorldBuilder 新增** |
| L1 遥感 | 气候带、海陆比、粗区域名 | 探测事件 / 首次选中 |
| L2 表面网格 | `frequency` 等由模型自拟 + 确定性地形 + 资源 | 首次 `enterPlanet` 或殖民 |
| L3 文明层 | 归属、建筑、仓储 | 殖民 / 推演占领 |

前端：`worldGrid` / `worldState` 改为 **按 `surfaceId` 多实例**（`Map<surfaceId, State>`），当前激活表面由 `app.state.activeBodyId` 决定。

### 2.4 星系与宇宙补全

```ts
interface Galaxy {
  id: string;
  name: string;
  seed: number;
  coords: { x: number; y: number; z: number }; // 星际图坐标
  systems: StarSystem[];
  completeness: 'stub' | 'skeleton' | 'detailed';
}

interface StarSystem {
  id: string;
  name: string;
  star: Body;          // kind=恒星
  bodies: Body[];
  completeness: 'stub' | 'skeleton' | 'detailed';
}
```

- **stub**：仅有名称 / 方向 / 距离，宇宙视图显示为未解析光点。
- **skeleton**：恒星 + 行星槽位（数量、类型分布），无表面。
- **detailed**：完整 `Body` 列表与轨道，表面按需 L2。

推演与探测会把 stub → skeleton → detailed；**禁止**开局生成全宇宙详细数据。

### 2.5 人物与 Agent 主体 `Character`

```ts
interface Character {
  id: string;
  civId: string;
  name: string;
  title: string;
  role: '领袖' | '关键人物' | string;
  // 契约字段
  gender: string;
  race: string;
  age: number;
  lifespanMax: number;
  bodyState: string;
  personality: Personality5D;  // code + dims + stability
  abilities: { name: string; val: number }[];
  background: string;
  motive: string;

  agent: {
    enabled: boolean;
    profileId: string;         // 如 persona.statesman.v3
    stance: string;            // 可被推演改写的短期立场
    memoryPolicy: 'short' | 'rolling' | 'archival';
    authority: AuthorityScope; // 可提交的决策域
    status: 'active' | 'dead' | 'exiled' | 'silent';
  };
}
```

**AuthorityScope 示例**

| role | 默认可决策域 |
|------|----------------|
| 领袖 | 国策、外交、宣战媾和、预算总纲、人事任免 |
| 总设计师 / 科研 | 科技路线、试验风险、工程排期 |
| 军政 / 舰队 | 军事部署、戒备等级、有限打击（受领袖否决） |
| 先知 / 神职 | 预警、仪式、信仰动员（弱强制） |
| 工匠 / 商 | 贸易、技术转让边界 |

冲突时：**领袖可否决下属**；同级按文明政体规则（议会票 / 帝命 / 长老共识）由「收敛器」裁定。

---

## 3. 多星球地图架构

### 3.1 前端改造要点

```
app.state.activeBodyId = 'gaiya' | 'yinhui' | …
app.state.activeSurfaceId

GE.surfaces.get(surfaceId) → { grid, state, meta }
view.planet.loadSurface(surfaceId)  // 重建或切换战略层
view.universe: landable → 进入星球（不再看 home）
```

1. **拆除 `home` 门闩**  
   - 进入条件：`flags.landable`  
   - UI：母星显示徽章；其他显示「进入星球 / 勘察」。

2. **Surface 注册表**  
   - `GE.worldGrid` → 工厂：`createGrid(topology)`  
   - `GE.worldState` → `createWorldState(surfaceDef, storageKey)`  
   - 持久化键：`genesis-engine-surface-${surfaceId}-v1`

3. **渲染**  
   - 程序化星球着色器按 `climateProfile` / `kind` 换参数（已有 styleMap 可扩展）。  
   - 战略层逻辑复用；区域色、首都种子按表面数据。

4. **未生成表面**  
   - 请求 `POST /api/surfaces/:bodyId/ensure`  
   - 返回 L1 或 L2；前端显示加载态，禁止半套缓存。

### 3.2 后端 Surface API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/bodies/:id` | 天体元数据 |
| POST | `/api/bodies/:id/surface/ensure` | 幂等确保 L2 网格种子与目录 |
| GET | `/api/surfaces/:id` | 表面定义（不含全量 tiles） |
| GET | `/api/surfaces/:id/tiles?bbox=&lod=` | 分片 / 摘要（后期）；原型可全量补丁 |
| GET | `/api/surfaces/:id/patches` | 自 revision 以来的变更 |
| POST | `/api/surfaces/:id/turn` | 战略回合（仓储、产出）— 可并入推演 |

**确定性**：相同 `(topology.seed, frequency, climateProfile)` → 相同基础地形；仅 `tilePatches` 存差异。

### 3.3 母星迁移路径

1. 将现有 `strategicMap` 挂到 `bodies.gaiya.surface`。  
2. `world.母星名` / `isPlayerHome` 保留叙事。  
3. 为 `yinhui`（银辉）等增加 `landable` + 独立 seed，验证第二套表面。  
4. 气态巨星本体默认 `landable:false`，其卫星可 landable。

---

## 4. 宇宙补全架构

### 4.1 为什么要「推演中补全」

- 全量预生成不可扩展，也与契约「探测 / 门槛科技」叙事冲突。  
- Agent（科学家、舰队、神谕）的决策应**创造**新地理，而非只改数字。

### 4.2 补全管线

```
探测/推演意图
    → WorldBuilder Agent（系统级，非文明领袖）
    → 结构化蓝图（JSON Schema）
    → Validator（轨道稳定、宜居带、命名、ID）
    → 写入 Galaxy/Body（skeleton/detailed）
    → 可选：为新 landable 体排队 surface.ensure
    → 前端宇宙视图增量挂载 meshes
```

### 4.3 WorldBuilder 输出契约（示例）

```json
{
  "op": "expand_system",
  "systemId": "xiyang",
  "addBodies": [
    {
      "tempId": "p-new-1",
      "kind": "岩质行星",
      "name": "……",
      "orbit": { "a": 310, "e": 0.04, "inc": 1.2, "period": 520, "phase": 0.3 },
      "flags": { "landable": true, "surveyed": "remote" },
      "climateProfile": { "hydrosphere": 0.1, "meanTemp": "hot", "energyAffinity": 0.2 },
      "desc": "……"
    }
  ],
  "narrativeBeat": "联邦深空阵列解析出内侧新岩质体的热特征。"
}
```

### 4.4 权限与节奏

| 来源 | 可补全范围 |
|------|------------|
| 文明科技 / 探测决策 | 本星系未详区域、邻近 stub 星系 |
| 纪元级事件 | 新星系 skeleton |
| 神谕（4/5 发现类或命运向星） | 可跳过**软**轨道叙事限制；**不可**绕过 P9 与 ID/物理硬校验；正式多人无「点名只给某敌国加星砸脸」 |
| 开局种子 | 仅 detailed 当前系 + 若干 stub |
| GM `gmFreeOracle` | 调试用；正式局默认关 |

### 4.5 前端宇宙视图

- `spaceBodies` → 订阅 `GET /api/systems/:id/bodies`。  
- 增量：WebSocket / SSE `body.added` | `body.updated`。  
- 保留开普勒轨道本地积分；服务端只下发轨道根数。

---

## 5. Agent 构筑方案

### 5.1 角色分层

```
┌─────────────────────────────────────────────┐
│  Orchestrator（推演编排器）                    │
│  回合切分 · 并发控制 · 收敛 · 落库 · 通知前端   │
└─────────────────────────────────────────────┘
         │              │                │
         ▼              ▼                ▼
   CharacterAgent   LensCritic      WorldBuilder
   （领袖/关键人物）   （六棱镜）      （宇宙/地表补全）
         │
         ▼
   Memory + Tools（读状态、提案、否决权查询）
```

### 5.2 CharacterAgent

每个 `agent.enabled` 的人物一个逻辑 Agent（实现上可协程复用同一推理后端，**提示词与记忆隔离**）。

**输入包（每轮）**

```ts
interface AgentTurnInput {
  roundId: string;
  year: number;
  character: CharacterPublic;
  civSnapshot: CivSnapshot;          // 国策、仓储摘要、科技进度、关系
  worldBrief: WorldBrief;            // 能级、纪元、重大新闻
  surfaceBriefs?: SurfaceBrief[];    // 该文明相关星球摘要
  pendingEvents: Event[];            // 上轮结果、神谕、外交
  privateMemory: MemorySlice;        // 滚动摘要 + 置顶动机
  authority: AuthorityScope;
  outputSchema: JSONSchema;          // 强制结构化决策
}
```

**输出包**

```ts
interface AgentDecision {
  characterId: string;
  civId: string;
  stance: string;                    // 更新后的短期立场
  intent: string;                    // 一句话意图（英雄史观主语）
  actions: ActionProposal[];         // 结构化动作
  publicSpeech?: string;             // 可选台词（小说体用）
  privateNote?: string;              // 不公开的算计
  urgency: '高' | '中' | '低';
}
```

**ActionProposal 类型（可扩展枚举）**

- `policy.set` / `tech.invest` / `military.deploy`  
- `diplomacy.*` / `explore.body` / `colonize` / `build.on_tile`  
- `research.risk_test` / `intelligence.probe`  
- `surface.survey`（触发 L1/L2）  
- `galaxy.probe`（触发 WorldBuilder）

非法动作（越权、资源不足）由 **规则引擎** 在 LLM 之后裁剪，不依赖模型自觉。

### 5.3 人格适配

| 来源字段 | 注入方式 |
|----------|----------|
| `personality.dims` + `code` | System 提示中的行为约束与文风（疏/隐/缓…） |
| `motive` | 每轮置顶，决策需可见呼应 |
| `abilities` | 影响可选动作权重（高军事 → 更多 military.*） |
| `agent.profileId` | 模板：执政官 / 工程师 / 军政 / 帝王 / 先知 / 长者 / 工匠 / 潮母… |
| `agent.stance` | 短期可改；大幅漂移需写入大事记 |
| `bodyState` / age | 健康危机事件、继承人逻辑 |

**稳定性 `S/A/B…`**：高稳定性人物立场低方差；低稳定性允许立场跳变（仍需 motive 自洽）。

### 5.4 六棱镜 LensCritic

与前端 `deduction.lenses` 对齐：`政治 / 军事 / 经济 / 科技 / 思潮 / 个人`。

- 输入：本轮全部 `AgentDecision` + 神谕 + 世界快照。  
- 输出：每棱镜一段影响分析 + 结构化 `WorldPatch` 候选。  
- 多轮（默认 4，可配置）：后轮看到前轮冲突，做收敛，避免单次幻觉。

### 5.5 收敛器 Resolver

纯规则 + 轻量模型辅助：

1. 合并补丁（科技进度、关系、仓储、地块、人物年龄/状态）。  
2. 冲突：同地块争夺、互相矛盾的国策 → 按军力/外交/政体表结算。  
3. 生成 `ChronicleEntry[]`（编年节点，挂人名）。  
4. 更新 `legacies` 暗线。  
5. 触发 WorldBuilder 队列中的补全任务。  
6. 产出 `DeductionRound` 供前端控制台展示。

### 5.6 与推演控制台 UI 的映射

| UI 阶段 | 后端 |
|---------|------|
| 决策提交 | 并行跑全部 CharacterAgent |
| 多棱镜推演 | LensCritic × N |
| 世界收敛 | Resolver + DB 事务 |
| 编年入册 | Chronicle + 通知 SSE |

**推演触发（与神谕专项对齐）**

- **主路径**：`WorldClock` 每现实 10 min → `year.tick`（轻量结算）；每 **N=5** 世界年（或神谕/事件队列非空）→ 自动 `Orchestrator.round`。  
- **神谕**：独立 `POST /api/runs/:id/oracle`（扣点、P9 校验），**不**塞进 deduce 请求体。  
- **调试/补推**（可选）：`POST /api/runs/:id/deduce` 无 body 或 `{ "force": true }`，仅房主/服务，用于卡死恢复；正式体验不依赖玩家点「推进」才过年。

```http
POST /api/runs/:runId/deduce
{ "force"?: boolean }
→ { round, decisions, lenses, patchesSummary, newBodies, newSystems, chronicle }

POST /api/runs/:runId/oracle
{ "tier": 1|2|3|4|5, "payload": { ... }, "dryRun"?: boolean }
→ { edictId, cost, pointsLeft, etaYear, preview }
```

玩家为观察者 + 点数神谕，无 `playerOrders` / 化身字段。细则：`docs/edict-system.md`。

---

## 6. 后端系统架构

### 6.1 推荐栈（草案，可替换）

| 层 | 建议 | 说明 |
|----|------|------|
| API | Node.js (Fastify/Nest) 或 Python (FastAPI) | 与前端同语言可共享类型时优先 TS |
| 任务队列 | Redis + BullMQ / 等价 | Agent 长耗时 |
| 状态库 | Postgres | JSONB 存 patch、编年 |
| 缓存 | Redis | 回合锁、会话 |
| 对象 | 本地 / S3 | 大体量 surface 快照（可选） |
| LLM | 可插拔 Provider | OpenAI 兼容 + 本地 |

### 6.2 核心服务

```
api-gateway
auth / run-session     # PlayerSeat 绑定
clock-service          # WorldClock year.tick / 暂停 / 积点
oracle-service         # 点数、档位、P9、EdictLedger
world-service          # Galaxy Body Surface TilePatch
civ-service            # Civ Character Relation Warehouse
deduction-service      # Orchestrator
agent-runtime          # Prompt · Tool · Memory
builder-service        # WorldBuilder 校验与落库
chronicle-service
realtime               # SSE/WebSocket
```

### 6.3 存档 `Run`

```ts
interface Run {
  id: string;
  seed: number;
  createdAt: string;
  year: number;                 // floor(WorldClock 连续年)
  era: { 纪元: string; 纪年: string; 核心特性: string };
  revision: number;             // 全局单调
  playerHomeBodyId: string;     // 叙事默认焦点；非进入条件
  agentMode: 'full' | 'hybrid' | 'rules_only';
  clock: {
    realEpochMs: number;
    worldYearAtEpoch: number;
    minutesPerYear: 10;
    paused: boolean;
    heavyDeduceEveryYears: 5;   // N
  };
  flags: {
    gmFreeOracle?: boolean;     // 正式多人默认 false
    gmBypassP9?: boolean;       // 默认 false
  };
}
```

所有写操作带 `revision`；前端乐观 UI + 冲突时拉全量快照。`PlayerSeat` / `EdictRecord` 见神谕专项 §6。

### 6.4 API 总表（最小集）

**世界**

- `GET /api/runs/:id/snapshot` — 启动前端用的压缩快照  
- `GET /api/galaxies` · `GET /api/systems/:id` · `GET /api/bodies/:id`  
- `POST /api/bodies/:id/surface/ensure`  
- `GET /api/surfaces/:id` · `GET /api/surfaces/:id/patches?since=`

**席位与时钟**

- `GET /api/runs/:id/me` — 我的席位、绑定文明、点数  
- `POST /api/runs/:id/clock/pause` · `POST .../resume` — 房主  

**文明与人物**

- `GET /api/civs` · `GET /api/civs/:id`  
- `GET /api/characters/:id` · `GET /api/characters/:id/memory`（调试）

**推演**

- `GET /api/deduction/pending` · `GET /api/deduction/rounds/:n`  
- `POST /api/runs/:id/deduce` — 可选强制补推（非主时钟路径）

**神谕**（权威定义见 `edict-system.md` §4.2）

- `GET /api/runs/:id/oracle` · `POST /api/runs/:id/oracle`  
- `POST /api/runs/:id/oracle/:eid/cancel` · `GET .../oracle/ledger`

**实时**

- `GET /api/runs/:id/events` — SSE：`year.tick` / `oracle.points` / `oracle.applied` / `oracle.rejected` / `round.progress` / `body.added` / `surface.ready`

### 6.5 安全与成本

- 每回合 Agent 调用上限、token 预算、超时降级（规则 AI 兜底决策）。  
- 神谕鉴权：**该 `PlayerSeat` 本人**花本人点；spectator 403；GM 旗标分权。  
- P9 指向性伤害校验见神谕专项；工具调用白名单；禁止 Agent 直接 SQL。  
- 全量 prompt / 输出落 `agent_traces` 表便于回放。

---

## 7. 数据迁移：从 Mock 到后端

### 阶段 A — 契约不破的前端重构（可无后端）

1. 引入 `Body.flags.landable`；`home` → `isPlayerHome`。  
2. `SurfaceRegistry`：盖亚表面从现有 `strategicMap` 迁入。  
3. 宇宙进入任意 landable；星球视图按 `activeBodyId` 切换。  
4. 银辉等第二表面：本地确定性生成验证。

### 阶段 B — 只读 API

1. 用后端托管 `data.world` 快照。  
2. 前端启动改 `fetch snapshot`。  
3. 推演仍可 Mock，但读数来自 API。

### 阶段 C — 真推演

1. CharacterAgent + Lens + Resolver。  
2. `POST deduce` 替换 `runDeduction`。  
3. WorldBuilder 接入探测类 action。  
4. **产品细则（无限宇宙 · 设施上图 · rules_only 优先）**：见 `docs/phase-c-deduce-universe.md`。

### 阶段 D — 多人 · 时钟 · 神谕 · 持久化增强

1. `PlayerSeat` 认领文明、断线重连、spectator。  
2. `WorldClock` + 积点 + `oracle-service`（P9）。  
3. Surface 分片加载（超大 frequency）。

---

## 8. 确定性与随机

| 数据 | 策略 |
|------|------|
| 网格拓扑 / 基础地形 / 基础资源 | `seed` 纯函数，可重建 |
| 文明初始归属 | seed + capitalSeeds |
| Agent 决策 | 非确定性；结果以 patch 为准持久化 |
| WorldBuilder 命名与槽位 | schema 校验 + 轨道硬约束；文案可变 |

**原则**：能重建的不入库；不能重建的（决策、补丁、编年）必须入库。

---

## 9. 目录建议（后端落地时）

```
/docs
  backend-agent-architecture.md    # 本文
  edict-system.md                  # 神谕专项（v0.2 锁定）
  api-openapi.yaml                 # 后续
  agent-profiles/                  # 人格模板
/server
  src/
    domain/        # Body Surface Character …
    services/
    agents/
      character/
      lens/
      builder/
      orchestrator/
    api/
    db/
/js                 # 现有前端；逐步 thin client
```

---

## 10. 验收标准（架构落地后）

1. **非母星**：至少 2 个 landable 天体可进入，各自战略网格与仓储互不串写。  
2. **母星语义**：仅叙事 / 默认焦点，不作为进入条件。  
3. **推演补全**：一轮含 `explore` / `galaxy.probe` 的推演可新增或升级 Body，宇宙视图无需刷新整页即可看到。  
4. **Agent**：每个 `agent.enabled` 人物每轮有独立 `AgentDecision`，摘要出现在推演控制台；日志含人名（英雄史观）。  
5. **棱镜**：六透镜结果写回 round，并产生可序列化 `WorldPatch`。  
6. **神谕**：多玩家独立点数；1～5 档与 3A/B/C 可提交；P9 点名伤害拒收；合规 patch 不可被 Agent 否决；时钟积点与暂停正确。  
7. **契约字段**：纪元、能级、文明、大事记、收藏夹等更新路径与 `创世契约.json` MVU 规则兼容。

---

## 11. 开放问题 · 产品拍板（2026-07-23）

> 以下为产品确认结论，实现以此为准。

### 11.1 多星球仓储模型 — 确认

**行星仓 + 帝国总仓（两级），跨星调拨带延迟。**

| 层级 | 职责 | 键 |
|------|------|----|
| 行星仓 `Warehouse@surfaceId` | 本表面产出 / 消耗 / 地块建筑吞吐 | `civId + surfaceId` |
| 帝国总仓 `Warehouse@empire` | 战略储备、跨星预算、科技与外交消耗优先扣此处 | `civId` |

- 地块产出先入行星仓；跨星须 `logistics.transfer`（受文明等级 / 航线约束）。
- 单表面阶段 UI 可合并展示，底层仍两级。

---

### 11.2 战略层 frequency — 由模型自拟

**不设固定 64/32/16 分档表。** L2 表面生成时由 **WorldBuilder / 勘察 Agent** 在结构化输出中自拟 `topology.frequency`（及 `seed`、气候等），经 Validator 钳制后落库。

**硬约束（规则层，非叙事）**

| 约束 | 值 | 原因 |
|------|-----|------|
| 允许集合 | `frequency ∈ {8,16,32,64}`（仅 2 的幂，与现 icosahedron-dual 细分一致） | 网格算法要求 |
| 上限 | `≤ 64` | 与现网母星同级，防爆内存 |
| 下限 | `≥ 8` | 过稀无法战略游玩 |
| 写时固定 | L2 一旦生成禁止静默改 frequency | tile id / patch 稳定 |
| 同体唯一 | 一 `bodyId` 一表面拓扑 | — |

**提示词侧引导（非硬编码表）**：模型应依据体量、宜居度、文明投入、叙事重要性自拟；母星级世界倾向高密度，前哨/小卫星倾向低密度。Validator 只做集合与上下限，不做「卫星必须 32」之类类型表。

**运行时**：前端同时只驻留 1 个完整表面网格；切星卸载。

---

### 11.3 玩家身份 — 观察者 + 神谕；**无化身**

**确认：创世观察者。不扮演、不附身任何领袖或关键人物。**

| 能力 | 状态 |
|------|------|
| 观看三视图 / 信息面板 / 收藏夹 | ✓ |
| 世界随现实时钟推进（观察） | ✓ 主路径；无需点推进才过年 |
| 神谕干涉 | ✓ **已锁定** `edict-system.md` v0.2 |
| 化身 / 附身 / 以某角色下令 | **取消，不做** |
| 玩家文明操作回合 | 不做（除非未来产品单独立项） |

- 每回合 **全部** `agent.enabled` 人物走 CharacterAgent（或规则降级），无「跳过玩家角色」。
- **删除** `playerOrders` / `possessCharacterId`；神谕与 deduce 请求体拆分。
- 收藏夹 / 小说体锁定：仅镜头与追踪，不接管决策。

**神谕系统**：细则已锁定于 **`docs/edict-system.md`（v0.2）**。

| 要点 | 规则 |
|------|------|
| 多玩家 | 一人绑定一文明；spectator 只读 |
| 时钟 | 现实 10 分钟 = 世界 1 年；暂停则年与点均停 |
| 点数 | 开局 **3** 点；每 50 世界年 +1；硬顶 15 |
| 档位 | 1 国策/思潮 · 2 神物 · 3 **A人物∥B外交∥C科技** · 4 事件 · 5 命运神谕 |
| **P9 公平** | **禁止指向性伤害他方文明**；全域灾变对所有文明同规则抽检（含发起者） |
| API | 时钟推演 + `POST /oracle`；神谕 patch 高于 Agent 且不可否决 |

---

### 11.4 LLM 供应商与预算 — 确认

**可插拔 Provider + 硬预算 + 人物分级 + 超时规则降级。**（同 v0.2 表，不重复展开。）

- 优先：各文明领袖 + 本回合高紧急关键人物。
- `run.agentMode = full | hybrid | rules_only`。

---

### 11.5 星球 / 星系扩展 — 由推演中的模型添加

**确认：不靠手工关卡表预铺全宇宙；由 AI 在推演中按因果添加星球与星系。**

| 触发 | 谁产出 | 结果 |
|------|--------|------|
| 探测 / 深空阵列 / 殖民前置等 `explore.*` / `galaxy.probe` 类动作 | 文明人物 Agent 提案 → **WorldBuilder** 结构化扩写 | 新 `Body` / 升级 stub→skeleton→detailed |
| 纪元级或叙事必要 | Orchestrator 调度 WorldBuilder | 新 `Galaxy` skeleton 或邻系光点 |
| 神谕（4/5，见专项） | 发现/命运向可入 WorldBuilder 队列 | 可跳过软限制；硬校验 + P9 仍生效 |

**Validator 硬约束（示例）**

- 轨道根数物理合理（半长轴不重叠灾难级、周期与 a 粗略一致）。
- ID / 命名唯一；坐标符合契约太空层习惯。
- `landable` 与 `kind` 兼容（气巨本体默认不可登陆等，可被神谕打破）。
- 单回合新增天体数量上限（防一回合刷爆宇宙）。

**前端**

- 宇宙视图订阅增量：`body.added` / `system.added` / `galaxy.added`。
- 视图路由仍为 planet / universe / blackhole；多星系用宇宙相机拉远 + 飞入系（实现细节随内容增长迭代，不单独立项「星区图」路由）。
- 新 `landable` 体首次进入走 `surface/ensure`（frequency 见 §11.2 模型自拟）。

---

### 11.6 决议一览（终稿）

| # | 问题 | 拍板 |
|---|------|------|
| 1 | 多星仓储 | **行星仓 + 帝国总仓**，跨星调拨带延迟 |
| 2 | 网格密度 | **模型自拟** `frequency ∈ {8,16,32,64}`，Validator 钳制，写时固定 |
| 3 | 玩家身份 | **观察者 + 点数神谕**；**无化身**；多人一人一文明；细则 `edict-system.md` v0.2 |
| 4 | LLM 预算 | **可插拔 + 分级 + 硬顶 + 规则降级** |
| 5 | 宇宙扩展 | **推演中由 AI（WorldBuilder）添加星球 / 星系**，前端增量挂载 |

---

## 12. 建议的近期实现顺序

1. 写本 MD（✓）并产品拍板开放问题（✓ 见 §11）。  
2. 神谕专项 v0.2 锁定（✓ `edict-system.md`）。  
3. 前端 SurfaceRegistry + `landable` 进入（无后端也可玩）；表面拓扑字段预留模型自拟。  
4. 仓储两级数据结构（单表面时 UI 合并）。  
5. OpenAPI 最小集 + snapshot；含 `PlayerSeat` / clock / oracle 路径。  
6. `WorldClock` + 轻量年结算；Orchestrator + CharacterAgent 闭环（无化身）。  
7. `oracle-service` + P9 接入 Drain 队列。  
8. WorldBuilder：推演动作驱动新增 Body / Galaxy；宇宙视图增量。  
9. 全文明并行与暗线 / 大事记自动写入。

---

*本文是实现前的架构契约，不直接改运行时代码。实现时以本文件章节编号回链 PR / Issue。*
