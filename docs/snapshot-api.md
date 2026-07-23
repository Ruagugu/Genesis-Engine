# 创世引擎 · Snapshot 只读 API（阶段 B）

> 状态：阶段 B 只读 ✓ · 阶段 C 写路径已开 · 2026-07-24  
> 对齐：`docs/backend-agent-architecture.md` §6.4 / §7；细则 `docs/phase-c-deduce-universe.md`

## 目标

- 用**版本化快照**托管当前 Run 权威状态（开局种子迁入 `discovered`）。
- 前端可通过 `local`（现有内存种子）或 `http`（本 API）两种 Provider 启动。
- **阶段 C** 开放 `POST /runs` 与 `POST /runs/:id/deduce`；其余写方法仍 `405`。不含地块全量、SSE。

## 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/health` | 存活与阶段标记（phase=`C`，`writeOps:true`） |
| GET | `/api/v1/snapshot` | 启动用压缩世界快照（含 `revision` / discovered 摘要） |
| GET | `/api/v1/bodies` | 天体列表 |
| GET | `/api/v1/bodies/:id` | 单天体 |
| GET | `/api/v1/surfaces/:id` | 表面定义（无 tiles）；`:id` 可为 `gaiya:surface` 或 `gaiya` |
| GET | `/api/v1/runs` | Run 列表 |
| GET | `/api/v1/runs/:id` | Run 元数据 |
| GET | `/api/v1/runs/:id/snapshot` | 指定 Run 快照 |
| GET | `/api/v1/runs/:id/bodies` | 指定 Run 的 bodies / galaxies / systems |
| **POST** | `/api/v1/runs` | 创建 / 重置 Run（body: `{ id?, seed?, reset? }`） |
| **POST** | `/api/v1/runs/:id/deduce` | **真推演主写路径**（body: `{ force?, edict? }`） |
| **POST** | `/api/v1/bodies/:id/surface/ensure` | 幂等确保 landable 表面定义（无 tiles） |
| **POST** | `/api/v1/runs/:id/bodies/:bodyId/surface/ensure` | 同上，指定 Run |
| POST | `/api/v1/runs/:id/reset` | 调试：重置 Run |

非白名单写方法返回 `405 method_not_allowed`。

### surface/ensure 响应（最小）

```jsonc
{
  "ok": true,
  "created": true,
  "revision": 3,
  "body": { "id": "…", "surfaceId": "…:surface", "surfaceSeed": 123, "flags": {} },
  "surface": {
    "id": "…:surface",
    "bodyId": "…",
    "biomeKind": "arid_rock",
    "topology": { "kind": "icosahedron-dual", "frequency": 16, "seed": 123 },
    "regions": [],
    "notes": { "tiles": "not-included" }
  }
}
```

## Snapshot DTO（schemaVersion = 1）

```jsonc
{
  "schemaVersion": 1,
  "apiVersion": "v1",
  "runId": "local-seed",
  "revision": 0,
  "generatedAt": "ISO-8601",
  "clock": {
    "year": 1247,
    "era": { "纪元": "曙光纪元", "纪年": "第4纪元", "核心特性": "…" },
    "paused": true,
    "realtimeMinutesPerYear": 10
  },
  "world": { /* GE.data.world */ },
  "civs": [ /* 文明 + 领袖 */ ],
  "spaceBodies": [ /* Body 公共字段 + flags */ ],
  "bodySurfaces": {
    "gaiya:surface": {
      "id": "gaiya:surface",
      "bodyId": "gaiya",
      "biomeKind": "terrestrial",
      "topology": { "kind": "icosahedron-dual", "frequency": 64, "seed": 20260723, "...": "…" },
      "regions": [],
      "capitalSeeds": {},
      "claimRadius": {},
      "resourceKeys": ["food", "…"],
      "buildingKeys": ["granary", "…"],
      "terrainKeys": ["ocean", "…"]
    }
  },
  "catalogs": {
    "terrain": {},
    "resource": {},
    "building": {}
  },
  "landableBodyIds": ["gaiya", "yinhui", "yanhe", "youxing"],
  "surfaceStates": {},
  "notes": {
    "tiles": "not-included",
    "warehouses": "client-local-or-surfaceStates",
    "writeOps": "none"
  }
  // 另含：civLevels, energyScale, races, relations, legacies,
  // deduction, eras, thresholds, chronicle, favorites, transcendent, eraCausal
}
```

### 体积与边界

| 数据 | 策略 |
|------|------|
| 世界 / 文明 / 天体 / 目录 | 全量进 snapshot |
| 表面定义 | 拓扑 + 区域 + 种子 + 目录键；**无 tiles** |
| 地块 / 仓储 revision | 客户端按 seed 确定性重建；`surfaceStates` 预留 |
| 写路径 | 无 |

## 前端 Provider

| mode | 触发 | 行为 |
|------|------|------|
| `local` | 默认 | 用已加载的 `GE.data` 构建内存快照 |
| `http` | `?data=http` 或 `localStorage ge-snapshot-mode=http` | `GET /api/v1/snapshot` 后 `applyToData` |

可选：`?api=http://host:port` 指定 API 根。

模块：`js/snapshot.js`

```js
await GE.snapshot.hydrate();          // boot 前
GE.snapshot.mode;                     // 'local' | 'http'
GE.snapshot.last;                     // 最近一次快照
GE.snapshot.buildFromData(GE.data);   // 纯函数构建
GE.snapshot.applyToData(snap);        // 写回 GE.data
```

## 本地启动

```bash
node server/api.mjs
# 或
npm start
```

浏览器：

- 本地种子：`http://localhost:8123/`
- HTTP 快照：`http://localhost:8123/?data=http`

## 与后续阶段的边界

- **阶段 C**：`POST /api/v1/runs/:id/deduce` 等写路径；snapshot 增加 revision / patches；无限宇宙骨架 + 设施上图。细则见 `docs/phase-c-deduce-universe.md`。
- **阶段 D**：席位、时钟、神谕、SSE；`surfaceStates` 与分片 tiles。
