# 创世引擎 · 阶段 C：真推演与无限宇宙

> 状态：**C0–C6 已落地**（rules_only 真推演 + 无限骨架 + 设施上图 + hybrid LLM 插口）· 2026-07-24  
> 产品契约确认日：2026-07-23  

> 对齐：`docs/backend-agent-architecture.md` §4 / §5 / §6.4 / §7 阶段 C；`docs/snapshot-api.md` 阶段边界  
> 前置：阶段 A（多表面 / 帝国仓储）✓ · 阶段 B（只读 Snapshot API）✓

---

## 0. 一句话

**阶段 C = 服务端 Run 权威 + `rules_only` 真推演（`POST deduce`）+「程序无限骨架 / 仅推演·探测才发现」+「建造 / 发射设施写入宇宙图 Body」**。  
LLM 细节补全与全量 CharacterAgent 为 **C.2 增强**，不挡住无限宇宙与设施上图两条硬需求。

---

## 0.1 真推演是否包含？— **是**

| 模块 | 阶段 C | 说明 |
|------|--------|------|
| Orchestrator 回合编排 | ✓ | 决策 → 棱镜 → 收敛 → WorldBuilder → 落库 |
| Character 决策（全启用 Agent 人物） | ✓ | **默认 `rules_only`**（模板 / 权重）；LLM 为 C.2 |
| 六棱镜 LensCritic | ✓ | 规则模板 + 结构化 patch 候选；LLM 增强可选 |
| Resolver 世界收敛 | ✓ | 仓储 / 关系 / 地块 / 人物状态 / 编年；挂人名 |
| `POST /api/v1/runs/:id/deduce` | ✓ | **替换前端 Mock 主路径** |
| WorldBuilder（探测扩宇宙） | ✓ | 程序骨架 + 规则命名；触发见 §2 |
| 设施上图（空间站等） | ✓ | 一等 `Body`，进 snapshot / 宇宙视图 |
| 现实时钟自动过年 | ✗ → D | |
| 神谕点数 / P9 / 多席位 / SSE | ✗ → D | |

前端 `runDeduction` 在阶段 C **必须**改为调用服务端 deduce；本地假数据仅允许显式 debug 开关，不得作为默认。

---

## 1. 产品硬需求（不可妥协）

| # | 需求 | 含义 |
|---|------|------|
| H1 | **宇宙无限大** | 不设星系 / 天体总数上限；开局只 materialize 当前焦点邻域，**禁止**预铺全宇宙 |
| H2 | **星系与星球无限生成** | 任意次数推演 / 探测均可在 frontier 外扩；生成失败不得靠「表满了」拒绝 |
| H3 | **混合权威** | **骨架程序生成**（坐标、恒星类型、行星槽位、轨道粗参）；**细节 AI / 规则补全**（命名、气候、叙事、特殊体） |
| H4 | **仅推演 / 探测触发可见详细体** | 未探测区不向玩家刷整系 detailed；**不**靠镜头移动凭空生成可交互天体 |
| H5 | **设施上图** | 发射、建造、部署产生的 **空间站 / 轨道设施 / 发射场关联轨道节点** 必须成为宇宙图上的 `Body`（或等价可渲染实体），增量出现，与种子静态表同等可订阅 |

阶段 C 交付范围：**无限骨架 + rules_only 推演闭环 + 探测发现 + 设施上图**。

---

## 2. 无限宇宙数据模型

### 2.1 三级完整度

```
Galaxy / StarSystem / Body
  completeness: stub | skeleton | detailed
```

| 级 | 内容 | 何时 materialize |
|----|------|------------------|
| **stub** | 星系 / 系：id、方向、距离量级、seed 句柄 | 探测 / 纪元 / 规则扩展 frontier 时写入 **Run 存档**（不是全宇宙预生成） |
| **skeleton** | 恒星 + 行星槽位数 / 类型分布 + 粗轨道 | 首次 `system.probe` / 深空阵列成功 |
| **detailed** | 完整 Body 列表、可挂 surfaceSeed；landable 可排队 surface | 轨道勘察 / 殖民前置 / 设施部署需要具体 id 时 |

### 2.2 无限的实现方式（不是一张无限大表）

- **坐标程序宇宙**：`runSeed + galacticCoord` → 确定性可重建「若被发现，会是什么骨架」。
- **只持久化已发现（discovered）集合** + 补丁（命名覆盖、设施、殖民地、特殊 AI 体）。
- 再发现同一坐标 → 同一骨架；设施 / 文明补丁叠在上面。

```
UniverseField（无限、可计算、默认不入库）
    └── DiscoveredIndex（Run 内有限：galaxyIds / systemIds / bodyIds）
            └── Overrides & Facilities（命名、survey 级、空间站、殖民 flag…）
```

### 2.3 坐标系（阶段 C 最小）

```ts
// 星系级粗坐标（星际图）
type GalacticCoord = { x: number; y: number; z: number }; // 整数格子或固定精度

// 系内：相对恒星的开普勒根数（与现 spaceBodies.orbit 对齐）
// 设施：parentBodyId + 轨道根 或 固定 Lagrange / 同步槽
```

- 开局：仅 **曦阳系 detailed**（现有 `spaceBodies` 迁入，含望舒轨道站）+ 可选邻域 stub 方向句柄（也可完全空 frontier，等第一次探测产出）。
- 扩展：探测结果给出 `coord` 或 `bearing+range` → 程序解析为 `galaxyId/systemId` → 写入 DiscoveredIndex。

### 2.4 ID 规则（稳定、可重建）

| 实体 | id 约定（示例） |
|------|-----------------|
| Galaxy | `g:{qx}:{qy}:{qz}` 或 hash(runSeed, coord) |
| System | `s:{galaxyId}:{localIndex}` |
| 程序行星 | `b:{systemId}:p{n}` |
| 设施 | `fac:{civId}:{seq}` 或 `fac:{parentBodyId}:{slot}`（**不**与程序行星 id 碰撞） |
| 现有种子 | 保留 `xiyang` / `gaiya` / `wangshu`… 作为开局 aliases |

---

## 3. WorldBuilder（程序主路径 + 规则细节）

### 3.1 输入触发（仅推演 / 探测，无镜头生成）

| 触发源 | 动作类型 | 产出 |
|--------|----------|------|
| 文明决策 / 规则 AI | `explore.system` / `galaxy.probe` / `explore.body` | 新 stub 或 stub→skeleton→detailed |
| 文明决策 | `facility.deploy` / `station.build` / `launch.mission`（见 §4） | **新 Body（空间站 / 设施）** 写入地图 |
| 纪元 / 规则事件 | 低频 | 可丢 1 个邻近 stub 入 frontier（可选） |
| 神谕 4/5 发现类 | **阶段 D**；C 可留接口不实现 | — |

**明确不做（C）**：相机拉远自动刷可点选星系。

### 3.2 管线

```
DeduceRound
  → 收集 explore* / facility* ActionProposal（rules_only 规则引擎生成）
  → WorldBuilder.expand(op)
       1) ProceduralSkeleton(runSeed, coord|parent)  // 确定性
       2) DetailFiller(rules | 可选 LLM)           // 命名 / desc / climate
       3) Validator（轨道、ID 唯一、landable↔kind、单回合数量帽）
       4) 写入 Run.discovered + revision++
  → 返回 newBodies / newSystems / newGalaxies / facilities
  → 前端 apply 增量（轮询 snapshot 或 deduce 响应内嵌即可；SSE → D）
```

### 3.3 单回合安全帽

| 约束 | 建议默认 |
|------|----------|
| 每回合新增 Galaxy | ≤ 1～2 |
| 每回合新增 System detailed | ≤ 1 |
| 每回合新增 Body（含设施） | ≤ 8～16 |
| 每 Run 热数据：detailed systems 常驻 | 可淘汰远端 detailed → 退回 skeleton 摘要（可选 C 末做） |
| frequency | 仍 ∈ {8,16,32,64}，写时固定 |

**无限 = 可无限次扩展总集合**，不是单回合无限吞吐。

### 3.4 Validator 硬约束

- 轨道半长轴不灾难重叠；周期与 a 粗一致
- id / 名在 Run 内唯一
- `type/kind` 与 `landable` 兼容（气巨本体默认不可登陆；**空间站 landable:false**）
- 设施必须有合法 `parent`（天体或恒星）与轨道槽
- 禁止一回合清空预算刷爆宇宙（与规则资源扣减联动）

---

## 4. 设施上图（一等 Body）

> 分类谱系、LOD 与 mesh 配方见 **`docs/facility-map-drawing-plan.md`**。

现有种子已有 **`望舒轨道站`（type: 空间站, parent: gaiya）**，宇宙视图已能绘制空间站。阶段 C 一般化：

### 4.1 设施模型

```ts
interface FacilityBody extends Body {
  type: '空间站' | '轨道设施' | '星门' | '采矿站' | string; // C 最少：空间站 + 通用轨道设施
  parent: string;           // 宿主 bodyId
  flags: {
    landable: false;
    surveyed: 'surface' | 'orbital';
    artificial: true;
    civId?: string;         // 所属文明
    facilityKind: 'habitat' | 'shipyard' | 'array' | 'outpost' | 'launch_platform' | string;
  };
  builtAtYear?: number;
  builtByCharacterId?: string;  // 英雄史观
}
```

### 4.2 必须上图的动作（C 最小集合）

| 玩家 / Agent 语义 | ActionProposal | 地图结果 |
|-------------------|----------------|----------|
| 建造 / 部署空间站 | `station.build` | 新 `Body` type=空间站，挂 parent 轨道，宇宙图立即可见 |
| 发射并建立轨道设施（望远镜、星链节点、船坞等） | `facility.deploy` | 同上，subtype / facilityKind 区分 |
| 发射任务但仅过境（不建站） | `launch.mission` | **可不**建永久 Body；若任务产物是「留下硬件」则转 `facility.deploy` |
| 地表发射场 | `build.on_tile`（行星仓） | **行星战略图**建筑；若绑定「配套轨道节点」可再 spawn 一个轨道 Body |

规则：

1. **持久设施 = 宇宙 / 系统地图上的实体**，不只是编年文案。
2. `POST deduce` 响应与后续 `GET snapshot` 的 `spaceBodies` **必须包含**新建设施。
3. 拆除 / 摧毁（若 C 做）→ `body.removed` 或 `flags.destroyed` + 视图卸载。
4. 命名：规则模板（`{civ短名}·{宿主}·{序号}`）或 AI；id 稳定。

### 4.3 与仓储 / 权限

- 建站消耗走 **帝国总仓 / 行星仓**（阶段 A 已有汇总；C 用规则扣减）。
- 越权 / 资源不足 → 规则引擎裁掉 action，**不**出幽灵站。
- 设施归属 `civId`；他方可见性：C 可先「同系均可见」，战争迷雾留给 D。

---

## 5. 真推演（rules_only 主路径）

### 5.1 Run 最小存档

```ts
interface Run {
  id: string;
  seed: number;
  year: number;
  revision: number;
  era: { 纪元: string; 纪年: string; 核心特性: string };
  discovered: {
    galaxies: Galaxy[];
    systems: StarSystem[];
    bodies: Body[];          // 含种子迁入 + 生成 + 设施
  };
  surfaceStates: Record<string, unknown>;  // 沿用 A/B；未详细 surface 可空
  warehouses?: unknown;                    // C 建议开始服务端权威摘要
  deductionRounds: DeductionRound[];
  agentMode: 'rules_only' | 'hybrid' | 'full';  // C 默认 rules_only
}
```

### 5.2 API（在阶段 B 只读之上开放写）

| 方法 | 路径 | 说明 |
|------|------|------|
| 已有 GET | `/api/v1/health` · `/snapshot` · `/bodies` · `/surfaces…` | snapshot 增加 `revision`、完整 `spaceBodies`（含设施）、`discovered` 摘要 |
| **新** POST | `/api/v1/runs` | 创建 / 加载本地 run（可用固定 `local-seed`） |
| **新** GET | `/api/v1/runs/:id` | run 元数据 |
| **新** POST | `/api/v1/runs/:id/deduce` | **唯一主写路径（C）**；body 可选 `{ force?: boolean }` |
| **新** GET | `/api/v1/runs/:id/bodies` 或沿用 snapshot | 增量后全量 bodies |
| 可选 POST | `/api/v1/bodies/:id/surface/ensure` | 新 landable 首次进入 |

非 GET 除上述白名单外仍 **405**。

### 5.3 `POST …/deduce` 响应（最小）

```jsonc
{
  "runId": "…",
  "revision": 12,
  "year": 1248,
  "round": { "n": 3, "phase": "done" },
  "decisions": [ /* rules_only 人物决策，挂 characterId / name */ ],
  "lenses": [ /* 六棱镜摘要 */ ],
  "patchesSummary": { "warehouses": "…", "relations": "…", "tiles": "…" },
  "worldDelta": {
    "newGalaxies": [],
    "newSystems": [],
    "newBodies": [ /* 含新空间站 */ ],
    "updatedBodies": [],
    "removedBodyIds": []
  },
  "chronicle": [ /* 必须挂人名 */ ]
}
```

### 5.4 Orchestrator 步骤（C）

1. **Character 规则决策**：每个 `agent.enabled` 人物 1 条 `AgentDecision`（模板 / 权重，无 LLM）
2. **裁剪**：authority、资源、单回合帽
3. **LensCritic 规则版**：六棱镜固定模板文案 + 结构化 patch 候选
4. **Resolver**：合并仓储 / 关系 / 地块 / 年岁；写 chronicle（英雄史观，挂人名；覆盖所有文明镜头）
5. **WorldBuilder**：处理 explore* + station / facility* → 改 `discovered.bodies`
6. **revision++**，返回 delta

### 5.5 与推演控制台 UI 的映射

| UI 阶段 | 后端（C） |
|---------|-----------|
| 决策提交 | 规则 CharacterAgent（全启用人物并行逻辑） |
| 多棱镜推演 | LensCritic 规则版 × 六棱镜 |
| 世界收敛 | Resolver + Run 事务（内存 / 轻量 JSON） |
| 编年入册 | Chronicle 写入 + 响应返回（SSE → D） |

前端：`runDeduction` 改调 API；成功则合并 `spaceBodies` / revision，并通知 `view.universe` 重建或增量挂 mesh。

---

## 6. 前端改动要点

| 区域 | C 任务 |
|------|--------|
| `js/main.js` | `runDeduction` → HTTP deduce；失败回退提示（不再默默假数据，或显式 mock 开关） |
| `js/snapshot.js` | schema 支持 `worldDelta` 合并；bodies 含 artificial |
| `js/view.universe.js` | 已有空间站渲染；支持 **运行时** add/remove body mesh；新 type 走现有分支 |
| `js/data.world.js` | 开局种子标为 discovered detailed；导出 runSeed |
| 推演控制台 UI | 展示真实 decisions / lenses / **newBodies（含站）** |
| SurfaceRegistry | 新 landable detailed 可 ensure；设施默认不进星球网格 |

---

## 7. 任务拆解（实施顺序）

### C0 — 契约与种子迁入

- [x] 本文档落地（✓ 本文件）
- [x] Run 内存存储 + `revision`（`server/run-store.mjs`）
- [x] 现有 `spaceBodies`（含望舒）导入 `Run.discovered`
- [x] Snapshot 兼容字段：`revision`、`spaceBodies` 全量含设施

### C1 — 程序无限骨架

- [x] `ProceduralGalaxy/System`：`runSeed+coord` → stub / skeleton（`server/procedural-universe.mjs`）
- [x] DiscoveredIndex；未发现不出现在 snapshot
- [x] 单回合数量帽 + Validator
- [x] 规则命名器（非 LLM）

### C2 — 设施上图

- [x] Action：`station.build` / `facility.deploy`
- [x] 写 FacilityBody（`fac:{civId}:{seq}`）；资源扣减仍以客户端表面仓为主（C 薄）
- [x] deduce / snapshot 带回；宇宙视图 `reloadBodies`
- [x] QA：建站后 bodies 数量 + id 稳定 + 刷新仍在

### C3 — rules_only 真推演闭环

- [x] `POST /api/v1/runs/:id/deduce`
- [x] 规则 CharacterDecision + 六棱镜模板 + Resolver（`server/deduce-engine.mjs`）
- [x] 编年挂人名；全文明覆盖（契约铁律）
- [x] 前端控制台接线（替换 Mock 主路径；`?mockDeduce=1` 显式调试）

### C4 — 探测驱动扩展

- [x] 规则权重产生 explore / probe（含偶数轮保底探测）
- [x] 成功 → 新 stub / skeleton / detailed 入 Run
- [x] 响应 `worldDelta`；前端增量刷新宇宙图
- [x] QA：多轮 deduce 后 bodies / galaxies 单调增长且无 id 冲突

### C5 — 表面与着陆（薄）

- [x] `POST /api/v1/bodies/:id/surface/ensure`（及 runs 命名路径）
- [x] 客户端 `GE.surfaces.ensureDef` / `ensureRemote`：缺 def 确定性合成
- [x] 进入星球时自动 ensure；不破坏阶段 A 多表面仓储（无 capitalSeeds 不乱建仓）
- [x] 前端设置页：世界 API + OpenAI 兼容模型表单（拉 `/models`、试调用）

### C6 —（可选 C.2）LLM 插口

- [x] Provider 接入 deduce（`server/llm-provider.mjs`；请求体带 `agentMode` + `llm`）
- [x] Character 批量润色 + 可选 DetailFiller；超时 / 解析失败回落 rules_only
- [x] 前端配置 UI + `js/llm-config.js` 存储 / listModels / chat；`runDeduction` 转发凭证
- [x] 密钥仅随 deduce 转发、服务端不落盘；未启用 / 凭证不全 / 网络失败 → 规则引擎

---

## 8. 验收标准（阶段 C Done）

1. **无限**：连续 N 轮（N≥20）含探测的推演，可不断在 frontier 外增加 system / body，无固定上限报错；同一 `runSeed+coord` 重入骨架一致。
2. **触发边界**：不进行探测 / 推演时，不会因镜头移动凭空出现新可交互星系。
3. **设施上图**：一轮含 `station.build` / `facility.deploy` 的推演后，宇宙图与 snapshot 出现新空间站 / 设施 Body，刷新 / 重进仍在，且挂 parent 轨道。
4. **真推演**：`POST deduce` 替换主路径 Mock；decisions 挂人物；六棱镜 + chronicle 可序列化。
5. **兼容**：阶段 A 多表面仓储、阶段 B 只读 GET 与 local / http provider 不回归；QA 全绿并新增 deduce / universe 用例。
6. **体积**：snapshot 仍不含全量 tiles；仅 discovered 集合，不倾倒「整个无限宇宙」。

---

## 9. 明确留给阶段 D

- 现实时钟自动过年、神谕点数与 P9
- 多玩家席位 / SSE
- 镜头需求生成远景（若以后要「无限星海背景」）
- 设施战斗迷雾、跨星物流延迟完整模拟
- Surface 分片 tiles

---

## 10. 与既有文档的关系

| 文档 | 关系 |
|------|------|
| `backend-agent-architecture.md` §7 阶段 C | 本文为可实施细则；领域模型以架构文为准，冲突时以 **本文 H1–H5 + §0.1 真推演表** 为产品拍板 |
| `snapshot-api.md` | 阶段 B 只读；C 在其上增加 write 白名单与 revision / worldDelta |
| `edict-system.md` | 神谕仍属 D；C 不实现 `POST /oracle` |

---

*实现时以本文件章节编号回链 PR / Issue。*
