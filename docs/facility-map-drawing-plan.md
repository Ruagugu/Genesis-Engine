# 创世引擎 · 设施上图画图计划

> 状态：设计草案 v0.1 · 2026-07-23  
> 对齐：`docs/phase-c-deduce-universe.md` §4（设施 = 一等 Body）；`js/view.universe.js` 现有空间站网格；`js/data.world.js` 地表 `buildingCatalog`  
> 范围：**宇宙 / 系统图上可见的人造设施** 分类、视觉语言、LOD 与阶段落地  
> 非目标：地表战略格建筑像素稿（已有 granary/forge…）；舰船编队实时战斗锁步

---

## 0. 设计目标

从科幻小说 / 影视 / 游戏的「人造轨道与星际硬件」中抽出**可复用的形态原型**，使：

1. **上图即叙事**：望舒、星链、船坞、阵列、星门在星图上一眼可辨，且挂文明色。  
2. **无限可扩展**：新设施 = 选 `facilityClass` + `facilityKind` + 少量参数，不必为每种写死 mesh。  
3. **与推演动作对齐**：`station.build` / `facility.deploy` / `launch.mission` 产物都能落入某一类。  
4. **性能可控**：同屏数百节点时，远距用图标/点精灵，近距才上完整 Group。

**原则**：形态按「物理学与用途」归类，不按单部作品 IP 命名；文案可用世界内名称（望舒、星链）。

---

## 1. 两层设施（勿混）

| 层 | 存储 | 视图 | 示例 |
|----|------|------|------|
| **A. 轨道 / 星际设施** | `Body`（`flags.artificial`） | **宇宙图** `view.universe` | 空间站、星门、戴森碎片、采矿站 |
| **B. 地表设施** | tile `building` / 行星仓 | **星球战略图** `view.planet` | 粮仓、锻炉、地表发射场、光伏 |

本计划主写 **A 层画图**。B 层仅在「地表发射场 → 配套轨道节点」时与 A 联动（spawn 一个轨道 Body）。

---

## 2. 科幻谱系 → 形态原型（覆盖表）

下列作品只作**形态溯源**，实现不引用商标名。  
实现：`js/facility-mesh.js`（**28 class** 均有 L1 配方）；种子预览体见 `data.world.js` 中 `fac-*`。

| 谱系 / 常见设定 | 代表意象 | facilityClass | 预览体 |
|-----------------|----------|---------------|--------|
| 国际空间站、望舒、前哨 | 桁架 + 舱段 + 小环 | `station_modular` | 望舒 |
| 轨道居住环、O’Neill | 大环 + 辐条 | `habitat` | 天枢居住环 |
| 船坞 / 干船坞 | 框式龙骨夹具 | `shipyard` | 天工船坞 |
| 环形合拢坞 | 双环抱体 | `drydock_ring` | 环式合拢坞 |
| 深空阵列、VLA | 主碟 + 子碟 | `array` | 听风碟阵 |
| 星链 / GPS 星座 | 多节点 + 虚线环 | `constellation` | 星链星座 |
| 小行星采矿锚 | 锚爪 + 鼓 | `mining` | 锚爪七号 |
| 轨道提炼厂 | 多竖井烟囱 | `refinery` | 碎星提炼站 |
| 燃料库 / 氦-3 罐 | 球罐簇 | `depot` | 戊己燃料库 |
| 燃料驳船 | 长罐 + 帆板 | `fuel_tanker` | 运油鲸 |
| 恒星工程局部 / 戴森弧 | 弧瓣 | `stellar_infra` | 曦阳采光弧 |
| 星门 / 跃迁环 | 大环 + 门幕 | `gate` | 试作星门·零 |
| 太空电梯锚 | 锚球 + 下行缆 | `tether` | 天梯锚点 |
| 防御平台 / 轨道炮 | 平台 + 炮管 | `defense` | 天盾一号 |
| 科研 / 试验站 | 细长臂 + 玻舱 | `lab` | 苏砚试验站 |
| 医院 / 隔离 | 红十字 | `hospital` | 白羽医疗站 |
| 监狱 / 流放站 | 栅柱圆筒 | `prison` | 寂链监仓 |
| 外交 / 会馆 | 礼仪环 + 厅 | `embassy` | 诸邦会馆 |
| 轨道工厂 | 厂房体块 | `factory` | 符火装配厂 |
| 轨道农场 / 水培环 | 绿环 + 板 | `farm_orbit` | 翠环轨道田 |
| 传感浮标 | 小球 + 杆 | `sensor_buoy` | 曦测浮标 |
| 激光通讯中继 | 锥 + 光束 | `laser_comm` | 青虹中继 |
| 磁帆工场 | 大帆面 | `mag_sail_yard` | 磁帆工场 |
| 低温 / 种子库 | 冰蓝罐 | `cryo_vault` | 寒眠库 |
| 行星改造台 | 喷流锥 | `terraformer` | 新芽改造台 |
| 灵能尖塔 | 晶体锥 + 晕 | `essence_spire` | 灵脉尖塔·轨 |
| 世代舰 / 方舟 | 多层环圆柱 | `ark` | 方舟·未名 |
| 黑洞监视站 | 紫碟 + 指示 | `observatory_bh` | 瞳缘监视站 |
| 未分类回落 | 柱 + 环 | `generic` | 无名构造-X |

**覆盖结论**：28 个 class 覆盖硬科幻基建、后勤、社会设施、跃迁与恒星工程、本世界灵能；`facilityKind` 为 class 下细分（见 §3）。

---

## 3. 分类体系（数据契约）

### 3.1 字段（扩展 phase-c FacilityBody）

```ts
type FacilityClass =
  | 'station_modular'  // 模块站 / 前哨
  | 'habitat'          // 居住环 / 筒
  | 'shipyard'         // 船坞
  | 'array'            // 传感 / 通讯阵列
  | 'constellation'    // 星座（多节点逻辑一体）
  | 'mining'           // 采矿 / 提炼
  | 'depot'            // 仓储 / 燃料库
  | 'stellar_infra'    // 恒星工程局部
  | 'gate'             // 跃迁 / 星门
  | 'tether'           // 电梯 / 天钩锚
  | 'defense'          // 防御平台
  | 'lab'              // 科研 / 医学
  | 'ark'              // 方舟级（稀有）
  | 'observatory_bh'   // 黑洞监视
  | 'generic';         // 回落：未知 / 模版

interface FacilityVisual {
  class: FacilityClass;
  kind: string;              // 细类：outpost | shipyard_drydock | comm_constellation …
  scale: 'micro' | 'small' | 'medium' | 'large' | 'mega';
  civTint?: string;          // 文明主色，覆盖默认 emissive
  parent: string;            // 宿主 bodyId 或恒星 id
  orbitSlot?: 'leo' | 'geo' | 'lagrange' | 'heliocentric' | 'free';
  constellationIds?: string[]; // class=constellation 时子卫星 id
  essenceAura?: boolean;     // 本世界灵能修饰
  status?: 'building' | 'active' | 'damaged' | 'abandoned' | 'destroyed';
}
```

`type` 字段（展示用）可继续用中文：`空间站` | `轨道设施` | `星门` | `采矿站` | …  
`flags.facilityKind` 与 `visual.kind` 对齐；**画图只读 `visual.class` + `scale`**。

### 3.2 facilityKind 推荐枚举（C 可先实现 ★）

| class | kind（示例） | 中文名意向 | 阶段 |
|-------|--------------|------------|------|
| station_modular | `outpost` ★ | 轨道前哨（望舒） | C |
| station_modular | `hub` ★ | 枢纽站 | C |
| station_modular | `customs` | 海关 / 检疫 | D |
| habitat | `ring_o` | 居住环 | C 视觉 / D 常用 |
| habitat | `cylinder` | 圆柱殖民地 | D |
| shipyard | `drydock` ★ | 干船坞 | C |
| shipyard | `slipway` | 滑道船台 | D |
| array | `radio_dish` ★ | 深空碟阵 | C |
| array | `optical` | 光学干涉 | D |
| array | `essence_listen` | 灵潮监听 | C 可选 |
| constellation | `comm_mesh` ★ | 通讯星座（星链） | C |
| constellation | `nav_beacons` | 导航信标网 | D |
| constellation | `mirror_swarm` | 反射镜群 | D |
| mining | `asteroid_clamp` ★ | 小行星锚站 | C |
| mining | `refinery` | 轨道提炼 | C/D |
| depot | `fuel_depot` ★ | 燃料库 | C |
| depot | `warehouse_orbit` | 轨道仓 | D |
| stellar_infra | `partial_ring` | 恒星环段 | D+ |
| stellar_infra | `collector_swarm` | 采集云 | D+ |
| gate | `ring_gate` | 环形星门 | D（科技门槛后） |
| gate | `relay` | 中继浮标 | D |
| tether | `space_elevator` | 太空电梯 | D（地表锚+轨道锚） |
| defense | `platform` ★ | 防御平台 | C 可选 |
| defense | `shield_sat` | 盾卫星 | D |
| lab | `research` ★ | 科研站 | C |
| lab | `biomed` | 生医隔离 | D |
| ark | `generation` | 世代舰停泊 | 稀有事件 |
| observatory_bh | `accretion_watch` | 黑洞监视站 | 与现有黑洞并存 |
| generic | `module` ★ | 未分类舱段 | 回落 |

---

## 4. 画图语言（Universe LOD）

### 4.1 三级 LOD

| LOD | 触发（相机距离 / 屏占比） | 表现 |
|-----|---------------------------|------|
| **L0 远** | 极远或同屏节点 > N | 彩色点 / 小十字精灵 + 可选涟漪；星座收成一条虚线环 |
| **L1 中** | 默认巡航 | **原型 Group**：2～5 个 primitive（柱/环/球/碟），文明色 emissive |
| **L2 近** | 聚焦该设施或双击卡片 | 加细节：窗点、太阳能板、慢旋转、状态灯；仍非写实 CAD |

阶段 C：**实现 L0 + L1**；L2 可与聚焦动画共用 L1 加强版。

### 4.2 Primitive 零件箱（统一用 Three 基础几何拼）

| 零件 id | Geometry | 用途 |
|---------|----------|------|
| `cyl_core` | Cylinder | 站体核心、船坞龙骨 |
| `box_truss` | Box 细长 | 桁架 |
| `torus_ring` | Torus | 居住环、星门、望舒环 |
| `sphere_tank` | Sphere | 储罐、核心舱 |
| `disk_dish` | Circle / 扁 Sphere | 天线碟 |
| `panel_solar` | Plane / 薄 Box | 帆板 |
| `spike_crystal` | Cone / 八面 | 灵能尖塔 |
| `claw` | 2～3 Box 组合 | 采矿锚爪 |
| `sprite_node` | Sprite | L0 点、星座子星 |

**望舒现状**（`view.universe`）：`Cylinder + Torus` → 直接映射 `station_modular` / L1 默认模板。

### 4.3 各 class 的 L1 拼装配方

| class | 默认拼装（L1） | 运动 | 色 / 光 |
|-------|----------------|------|---------|
| **station_modular** | `cyl_core` + 正交 `box_truss`×2 + 可选小 `torus_ring` | 慢自转 | 金属灰 + 文明 emissive 窗点 |
| **habitat** | 大 `torus_ring`（或长 `cyl_core`）+ 中心辐条 | 环自转（模拟重力暗示） | 暖白结构 + 内侧微光 |
| **shipyard** | 平行 `box_truss` 框 + 中空，可挂半透明「龙骨」盒 | 无 / 闪烁焊点 | 冷蓝工业 |
| **array** | 1 主 `disk_dish` + 2～4 小碟或十字臂 | 碟微俯仰 | 白 / 青雷达感 |
| **constellation** | 逻辑体：宿主轨道上 N 个 `sprite_node` + 半透明 `RingGeometry` 示意 | 公转 | 文明色链 |
| **mining** | 贴 parent 小行星表面偏移；`claw` + 小 `cyl_core` | 无 | 锈橙 / 矿尘 |
| **depot** | `sphere_tank`×2～4 簇拥短桁架 | 无 | 黄警告带 |
| **stellar_infra** | 以恒星为心的 **大弧**（部分 Torus / 自定义弧线） | 极慢 | 恒星色染色，透明度低 |
| **gate** | 大 `torus_ring` + 内侧 Additive 圆面 | 环缓慢慢转 | 紫 / 青门内侧 |
| **tether** | 轨道端 `sphere_tank` + 指向地表的半透明 Line | 无 | 缆绳淡色 |
| **defense** | 扁 `box` 平台 + 短炮管 Cone | 警戒闪烁 | 红/琥珀状态灯 |
| **lab** | 细长 `cyl_core` + 侧臂 `panel` / 小碟 | 无 | 冷白无菌感 |
| **ark** | 超大 `cyl_core` 或双环，scale=mega | 极慢滚转 | 庄重暗金 |
| **observatory_bh** | 小平台 + 指向黑洞的指示线 / 紫色 sprite | 无 | 紫雾，远离吸积 |
| **generic** | 单 `cyl_core` + 一圈环 | 慢转 | 中性灰 |

### 4.4 状态与修饰

| status / 修饰 | 视觉 |
|---------------|------|
| `building` | 线框感 opacity 0.45 + 施工闪点 |
| `active` | 正常 |
| `damaged` | 材质偏暗、缺一块 truss、红闪 |
| `abandoned` | 去 emissive、微尘 sprite |
| `destroyed` | 短时碎片后移除 mesh 或残骸 sprite |
| `essenceAura` | 外圈柔光 Sprite + 可选 `spike_crystal` |
| 文明色 | `civTint` 乘在 emissive / 窗点 / 星座点上 |

### 4.5 标签与选中

- 标签：沿用 `ml-name`；副行显示 class 短名或文明缩写。  
- 选中：与行星相同 `focusBody`；卡片文案区分「人造 / 自然」。  
- 星座：点击逻辑体 → 展开子节点列表；L0 只显示一个标签。

### 4.6 轨道线策略

| 类型 | 轨道线 |
|------|--------|
| 单设施（站、坞、库…） | 默认**不画**整圆（避免与卫星线缠死）；聚焦时画短弧或虚线 |
| constellation | 画淡色完整环（示意星座带） |
| gate / stellar_infra | 特殊：门无公转线；恒星基建用弧不闭合 |
| 与现码对齐 | 今日：`空间站` 不画 orbitLine；保持，并扩展到所有 `artificial` |

---

## 5. 与动作 / 科技的映射（便于推演）

| ActionProposal | 默认 class / kind | 典型宿主 |
|----------------|-------------------|----------|
| `station.build` outpost | station_modular / outpost | 行星 / 卫星 |
| `station.build` hub | station_modular / hub | 行星 GEO / 拉格朗日 |
| `facility.deploy` comm | constellation / comm_mesh | 行星 |
| `facility.deploy` array | array / radio_dish | 行星极轨 / 外系统 |
| `facility.deploy` mine | mining / asteroid_clamp | 小行星带 body |
| `facility.deploy` fuel | depot / fuel_depot | 任意轨道 |
| `facility.deploy` yard | shipyard / drydock | 行星 / 带 |
| `facility.deploy` lab | lab / research | 卫星 / 外行星 |
| `facility.deploy` defense | defense / platform | 母星轨道 |
| `build.on_tile` 发射场 + 轨道配套 | tether 或 station 微站 | 地表 + LEO |
| 门槛科技「跨恒星」后 | gate / ring_gate | 系外缘 |
| 能级 / 纪元恒星工程 | stellar_infra / partial_ring | 恒星 |

资源不足 / 越权：不 spawn Body（phase-c §4.3）。

---

## 6. 实现架构（画图侧）

```
GE.data.spaceBodies[]  (含 artificial)
        │
        ▼
view.universe.rebuildBody(b) 或 syncFromDelta(worldDelta)
        │
        ├─ natural: 现有 恒星/行星/卫星/带/黑洞 分支
        └─ artificial:
              visual = resolveFacilityVisual(b)
              mesh = FacilityMeshFactory.create(visual)  // class → 配方
              LOD controller 按相机距离切换 L0/L1
```

建议新模块（落地时）：

| 文件 | 职责 |
|------|------|
| `js/facility-catalog.js` | class/kind 表、默认 scale、中文名、科技门槛 |
| `js/view.facility-mesh.js` | Factory：class → THREE.Group；状态皮肤 |
| `view.universe.js` | 分支 `flags.artificial` / type 集合；增量 add/remove |

**不要**为每个 kind 复制一份 if/else；kind 只调参数（环半径、碟数量、是否 claw）。

---

## 7. 分阶段画图落地

### 阶段 C（必须可玩上图）

| 优先级 | class | 说明 |
|--------|-------|------|
| P0 | station_modular | 望舒迁移为配方；新建站同模 |
| P0 | constellation | 星链叙事已有，需可部署上图 |
| P1 | shipyard / array / depot / mining / lab | 各 1 个默认 kind 配方 |
| P1 | L0 点精灵 + 文明色 | 性能 |
| P2 | defense、essence 修饰 | 规则推演可产出 |
| — | gate / stellar_infra / tether / ark | **数据可出现，视觉可先用 generic** |

验收：建站 / 部署后宇宙图可见、刷新仍在、class 不同形态可辨。

### 阶段 D

- gate、tether（地月丝）、stellar_infra 专用 shader  
- L2 近景细节、损伤皮肤、星座展开 UX  
- 多文明色盲友好纹样（条带 / 点阵）  
- 与 SSE `body.added` 增量动画（淡入）

### 更远

- 戴森云粒子、方舟内部不进宇宙图  
- 舰队符号层（非永久 Body，另议）

---

## 8. 与现有资产对照

| 现有 | 归类 |
|------|------|
| 望舒轨道站 `type:空间站` | station_modular / outpost，L1 = 现 Cylinder+Torus |
| 叙事「星链星座」 | constellation / comm_mesh（C 需实体化多节点或逻辑环） |
| 地表 buildingCatalog | **B 层**，不上宇宙图；发射场可触发 A 层配套站 |
| 黑洞导航标记 | 自然体；observatory_bh 为环黑洞人造监视站 |

---

## 9. 美术约束（保持引擎气质）

- 低多边形、金属度高、加性光晕克制（对齐现有宇宙 hum）。  
- 避免写实 PBR 贴图依赖；程序色 + 简单噪声即可。  
- 灵能设施：多一层软光，不取代工业轮廓。  
- 命名：UI 用世界内中文；代码 class 用英文 snake。

---

## 10. 开放问题（实现前可再拍）

1. **星座**：一个 Body 内嵌 N 精灵，还是 N 个 Body + groupId？（建议 C：单逻辑 Body + `constellationIds` 子精灵，减 snapshot 体积）  
2. **mega 设施**是否允许挡住行星点击？（建议拾取优先级：设施 < 行星，或按距离）  
3. **generic 回落**是否在 UI 显示「未知构造」？（建议是，利于 AI 产出未登记 kind）

---

## 11. 一句话

**用 14 个 facilityClass + 零件箱拼装 + 三档 LOD，覆盖从望舒式前哨、星链、船坞、阵列、采矿库，到星门与恒星工程的主流科幻设施上图；阶段 C 先做模块站 / 星座 / 工业五件套可辨识网格，其余 kind 先挂数据与 generic 皮。**

---

*与 `phase-c-deduce-universe.md` §4 一并作为设施上图的产品 + 视觉契约。*
