# 创世引擎 · 阶段 E 任务书：创世之初

> 状态：**E0–E6 已落地** · 2026-07-27
> 产品拍板（2026-07-27）：注册 = **用户名+密码**；创建文明 = **表单+AI 补全**；落地范围 = **仅盖亚（MVP）**
> 对齐：`backend-agent-architecture.md` §7（A–D 已完成）、`phase-d-oracle.md`（席位/token 体系沿用）
> 前置：阶段 A–D 全部合入 main（`5afe95e`），QA 76/76 绿

---

## 0. 一句话

**阶段 E = 玩家从「认领预置文明」升级为「注册账号 → 创建自己的文明 → 在盖亚亲手选择落地地块」，同时清一批前端积欠 bug。**

---

## 1. 与阶段 D 的关系

| 沿用（D） | 升级 / 新增（E） |
|-----------|------------------|
| `PlayerSeat`（playerId=token、一人一文明、3 点开局） | token 不再随机匿名，改为**注册账号的稳定身份 token** |
| `claimSeat` / `me` / `seats` API | 创建文明成功后**自动认领**该文明席位 |
| 5 个预置文明仍可被认领 | 新增「玩家创建文明」入 run；预置与自建并存 |
| 创世重置：全文明 0 地块，`territorySeed` 兜底自动出生 | 玩家文明**落地点由玩家点选**，写入 `territorySeed` + `capitalSeeds` |
| 神谕/推演/时钟不变 | 推演需覆盖新文明镜头（引擎已按 run.civs 遍历，天然兼容） |

阶段 D 拍板的「本地匿名 playerToken、无 OAuth」在本阶段升级为**本地账号（用户名+密码）**；仍无 OAuth、无邮箱、无找回密码（见 §9 非目标）。

---

## 2. 产品契约

| # | 契约 | 值 |
|---|------|-----|
| E-P1 | 注册 | 用户名（2~24 字符，中英文数字 `._-`）+ 密码（≥6 位）；服务端 scrypt 哈希存储 |
| E-P2 | 身份 | 注册即签发**稳定 token**（`ge_` + 24 字节 hex），即 seat 的 `playerId`；换设备凭用户名密码登录取回同一 token |
| E-P3 | 一人一文明 | 沿用 D：已绑定席位不可换绑；创建文明 = 创建 + 自动绑定 |
| E-P4 | 文明创建输入 | 表单：名称（必填）、简称、主色、种族、气质倾向、起源一句话、领袖名（可选） |
| E-P5 | 文明生成 | 规则模板兜底生成完整创世态文明（level 0 / 原始 / 单领袖 / 空科技树 / 小 stats）；已配 LLM 时 AI 补全思潮、理念、特质、领袖背景与动机，失败回落规则 |
| E-P6 | 落地 | 仅盖亚（`gaiya:surface`）；玩家在星球图点选**无主且地形合法**的地块；确认后不可反悔（MVP） |
| E-P7 | 落地效果 | 写 `civ.territorySeed`（lat/lon）+ 表面 `capitalSeeds`/`claimRadius`；首块地块归属该文明并建行星仓；后续扩张走既有 territory 意图 |
| E-P8 | 上限 | 每账号 1 个自建文明（受 E-P3 约束）；每 run 文明总数 ≤ 12（含预置与分裂） |
| E-P9 | 兼容 | 未注册用户仍可 spectator 观察；旧匿名 token 的既有席位不迁移、不失效 |

**铁律回链**：新文明进入每轮推演的全文明镜头覆盖（契约铁律）；编年挂人物主语，落地事件挂开国领袖名。

---

## 3. 服务端设计

### 3.1 auth-service（新 `server/auth-service.mjs`）

```
users 存储：data/users.json（gitignore；env GE_USERS_PATH 可覆盖，QA 用 .qa-data/users.json）
user := { username, passSalt, passHash(scrypt), token, createdAt, lastLoginAt }
token = 'ge_' + randomBytes(24).hex     // 与 phase-d G1 对齐；每用户稳定不轮换
```

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/auth/register` | `{username, password}` → 201 `{token, username}`；重名 409 `name_taken` |
| POST | `/api/v1/auth/login` | `{username, password}` → `{token, username}`；错误 401 `bad_credentials` |
| GET | `/api/v1/auth/me` | `X-Player-Token` → `{username}` 或 404 |

- token 不轮换的原因：seat 体系以 `playerId === token` 为键；轮换会孤儿化席位。
- 密码：`crypto.scryptSync(password, salt, 64)`；比较用 `timingSafeEqual`。
- 不做限流/验证码（本地局）；用户名大小写不敏感查重、保留原样显示。

### 3.2 创建文明（新路由，逻辑入 `server/genesis-service.mjs`）

```
POST /api/v1/runs/:id/civs        （需 X-Player-Token；token 必须是注册用户）
{ name, short?, color?, race, temperament?, origin?, leaderName? }
→ 201 { civ, seat, revision }
```

流程：

1. 校验：名称非空 ≤24 字、run 内唯一；文明总数 < 12；该 token 无已绑席位（否则 409 `already_bound`）。
2. 规则模板生成创世态文明：`id = 'pc-' + seq`，结构与 `applyGenesisReset` 产物完全同构（level 0、stage 原始、`capital: '未定居'`、空科技树、stats 按 dawn 创世档、单领袖含 personality 五维/abilities/agent 状态块、`territorySeed: null`）。
3. **AI 补全（可选路径）**：`llmConfigured()` 时单次 chat（purpose `civ_genesis`）补全 思潮/国民理念/文明特质/起源扩写/领袖背景与动机/性格注；`parseJsonLoose` + 字段白名单校验；超时或解析失败 → 保留规则模板（不阻塞创建）。写 llm-log。
4. `run.civs.push` + `revision++` + 自动 `claimSeat`（displayName = username）。
5. 响应 civ 全量；前端按 `spawn` 语义合并进 `GE.data.civs`。

### 3.3 落地（settle）

```
POST /api/v1/runs/:id/civs/:civId/settle    （需 token 持有该文明席位）
{ surfaceId: 'gaiya:surface', tileId, lat, lon }
→ { ok, civId, capital, revision }
```

- 校验：MVP 仅接受盖亚表面；该文明尚未落地（`territorySeed` 为空）；lat/lon 数值合法。
- 写入：`civ.territorySeed = {lat, lon, weight: 1}`、`civ.capital = 名称（规则命名，AI 可后续改写）`、`civ.landing = {surfaceId, tileId, year}`。
- 编年：`{year} 年，{领袖名}率{文明名}先民于{地块地形}落地建居。`（挂人物）。
- 地块归属为**客户端权威**（territory.js 契约「客户端唯一写 tiles」）：前端确认后本地 `setTileOwner(tileId, civId, {claimSource:'landing'})` + 写激活表面 `capitalSeeds[civId]` / `claimRadius[civId]`，并 `ensureWarehouse`。其他客户端经 snapshot 的 `territorySeed` 在下轮扩张意图中自然出生（与现有 genesis 兜底路径一致）。
- 服务端不校验 tileId 与 lat/lon 一致性（客户端由拾取保证；服务端只存证）。

### 3.4 快照与推演兼容

- `toSnapshot` 已带 `civs` 全量 → 自建文明随快照下发，无 schema 改动。
- `deduce-engine` 按 `run.civs` 遍历决策/镜头/棱镜 → 新文明自动纳入；`buildTerritoryEvents` 硬编码 `gaiya:surface` 与 E-P6 一致。
- 未落地的自建文明：territory 意图对 `territorySeed === null` 的文明跳过出生（不落地就不占地）。

---

## 4. 前端设计

### 4.1 身份与入口

- 统一 token helper：`GE.auth`（新 `js/auth.js`）——收编 `main.js:playerToken` 与 `panels.js:playerToken` 两份分叉实现（修 bug F6）；存 `ge-player-token` + `ge-player-name`。
- HUD 右上新增身份区：未登录显示「登录 / 注册」按钮 → 弹窗（两个 tab：登录、注册）；已登录显示用户名。
- 登录成功后：`GET /runs/:id/me` → 有席位则正常进入；无席位且无自建文明 → 引导「创建文明」。

### 4.2 创建文明向导

- 弹窗表单（复用现有 modal 体系）：名称、简称（默认取名称前 2 字）、主色（色板）、种族（文本或预设列表）、气质倾向（如 尚武/求知/重商/守序/灵性 单选）、起源一句话、领袖名（可空 = 模板起名）。
- 提交 → `POST /civs` → 成功合并 civ 进 `GE.data.civs`（走既有 spawn 合并路径，并补 bug F8 的 warehouse/registry 引导）→ 直接进入落地模式。

### 4.3 落地模式（盖亚星球图）

- `app.state.landingCivId` 非空时进入：顶部横幅「选择你的落地之地 —— 点击一块无主土地」。
- 复用 `pickHex` 链路：点击地块 → 落地确认卡（地形/区域/资源摘要 + 「确认落地」/「重选」）。
- 合法性：无主（`!ownerCivId`）+ 地形规则（水生种族仅水域，否则仅陆地——沿用 `territory.js` 的 `terrainAllowed`）。
- 确认 → settle API → 本地 `setTileOwner` + `capitalSeeds` 写入 + `rebuildStrategicMap` + 镜头 `focusCapital`（此时 bug F1 已修，能真正聚焦）+ 编年 toast。

---

## 5. 前端 bug 修复清单（本阶段一并处理）

来源：2026-07-27 代码摸底。编号 F1–F11。

| # | 位置 | 问题 | 处理 |
|---|------|------|------|
| F1 | `view.planet.js:744` | `_capitals` 用被创世重置清空的 `capitalSeeds` 过滤，永空；`focusCapital` 静默失效（civ 卡片点击、文明面板按钮均废） | capitals 改为动态派生：优先 `capitalSeeds`，否则取该文明首个 `claimSource in {seed,landing}` 地块 |
| F2 | `territory.js:292` | 回退调用不存在的 `GE.views.planet.buildStrategicMap`，TypeError 被空 catch 吞掉 | 改调已暴露的 `rebuildStrategicMap` |
| F3 | `territory.js:153-164` | 出生后 pick 为空时返回 `changed:1` + 已占地块，虚增「疆域变动」toast 并触发多余重建 | 出生本身单独计数，不伪造 changed 地块 |
| F4 | `territory.js:149` | 三元恒 0 的死代码 + `frontierTiles` 对 4 万地块网格重复全扫 | 删死代码，单次扫描复用 |
| F5 | `territory.js:215-219` | `splitCiv` 空 if 块 + `||` 优先级歧义（水陆判定意图不明） | 显式括号 + 补齐/删除空块 |
| F6 | `main.js:75` / `panels.js:784` | playerToken 双实现且 catch 行为分叉（null vs 每次新 token→孤儿席位刷 3 点） | 收编进 `js/auth.js` 单一实现 |
| F7 | `panels.js:842` | displayName 硬编码「旅人」 | 用注册用户名 |
| F8 | `main.js:1060` | spawn 文明无 capitalSeeds/warehouse/registry 引导 | 补引导；与自建文明合并路径共用 |
| F9 | `view.planet.js:1198` | `rebuildStrategicMap` 后用户图层开关被重置 | 重建后重放 `setLayer` 状态 |
| F10 | `server/api.mjs:220` | `/health` 的 `writeAllow` 清单过期（漏 spectate/advance/cancel/reset/ensure/DELETE） | 补全（顺手，服务端） |
| F11 | `world-state.js:456` | facade 未代理 `tilesOwnedRatio`/`warehouseCivIds`/`storageKey`，`surface-registry` 被迫穿透 `entry.state` | 补代理 |

---

## 6. QA（新 `qa/genesis-start.spec.mjs` + 回归）

| # | 用例 | 期望 |
|---|------|------|
| 1 | 注册 → me | 201 拿 token；`auth/me` 返回用户名 |
| 2 | 重名注册 | 409 `name_taken`（大小写不敏感） |
| 3 | 错密码登录 | 401；正确密码返回同一 token（稳定性） |
| 4 | 未注册 token 建文明 | 401/403 拒绝 |
| 5 | 注册后建文明（rules 路径） | 201；civ 结构同构创世态；席位自动绑定；displayName=用户名 |
| 6 | 二次建文明 | 409 `already_bound` |
| 7 | run 文明数达 12 | 拒绝 |
| 8 | settle 盖亚合法地块 | ok；`territorySeed`/`capital`/编年落库；重复 settle 409 |
| 9 | settle 非盖亚 | 422（MVP） |
| 10 | 前端全流程 | 页面内：注册 → 创建文明 → 落地模式点选 → 确认 → 该文明地块 ≥1、仓库存在、focusCapital 生效 |
| 11 | 推演覆盖 | 落地后 deduce：新文明出现在 decisions 与镜头；扩张意图可增地块 |
| 12 | 回归 | 既有 76 用例全绿；F1–F11 各补断言（能单测的单测） |

---

## 7. 关键文件

| 动作 | 路径 |
|------|------|
| 新 | `docs/phase-e-genesis-start.md`（本文） |
| 新 | `server/auth-service.mjs` |
| 新 | `server/genesis-service.mjs`（创建文明 + settle + AI 补全） |
| 新 | `js/auth.js`（token/身份统一 helper） |
| 改 | `server/api.mjs` — auth/civs/settle 路由、writeAllow 补全 |
| 改 | `server/run-store.mjs` — 文明数上限常量、settle 字段迁移兜底 |
| 改 | `js/main.js` / `js/panels.js` / `index.html` — 登录注册弹窗、创建向导、落地模式、HUD 身份区 |
| 改 | `js/view.planet.js` / `js/territory.js` / `js/world-state.js` — F1–F5、F9、F11 |
| 新 | `qa/genesis-start.spec.mjs` |
| 改 | `.gitignore` — `data/users.json` |

---

## 8. 里程碑

```
E0 本任务书 ✓
E1 auth-service + 路由 + QA 1–4 ✓
E2 genesis-service 创建文明（规则模板 + LLM 异步补全）+ QA 5–7 ✓
E3 settle + 服务端存证 + QA 8–9 ✓
E4 前端：auth.js / 登录注册 / 创建向导 / 落地模式 + QA 10–11 ✓
E5 F1–F11 bug 批（F10 在 api.mjs；其余见各文件 F# 注释）✓
E6 全量回归绿 → 提交合并 ✓
```

实现备注：
- LLM 补全为**创建响应后异步**执行，成功时 `revision++` 并广播 SSE `civ.enriched`（不阻塞创建）。
- `terrainAllowed` 升级为按水陆属性判定（`waterCiv`：abyss + 名称/种族/特质含水栖关键词），玩家水栖文明可落水域。
- 神谕向导 QA 用例改为自带 `local-seed` reset：阶段 E 后其他用例可能先占 owner 席位。

---

## 9. 明确不在阶段 E

- OAuth / 邮箱验证 / 找回密码 / 多设备会话管理（token 即会话）
- 非盖亚落地、二次迁都、落地重选
- 玩家文明专属剧本 / 开局加成设计
- 文明删除 / 席位解绑
- 多 run 大厅（仍单 run `local-seed` 为主）

---

*实现以本文件章节编号回链提交信息。产品冲突时以 §2 契约为准。*
