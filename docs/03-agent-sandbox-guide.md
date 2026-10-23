# OpusMC (htgame)：基于 Gemini Task 沙箱的协作 Agent 开发、验证与防坑指南

本指南总结了在 **Gemini Task 沙箱（Linux VM）** 环境下开发、调试、审计与打包 **OpusMC（htgame）** 项目的实战经验。协作 Agent 在开始任何新阶段（如 W1 酿造与水下游泳、W2 活塞/比较器/侦测器与樱花林、W3 下界与末地终局）前，请先阅读本指南并直接使用内置的自动化校验与打包工具。

## 1. 我们是如何排查并发现本轮致命错误的（5 步审计方法论）

在接收协作 Agent 提交的工程包与补充文件时，我们没有仅凭测试脚本的“通过”输出放行，而是执行了以下 **5 步交叉审计流水线**，逐一定位出所有阻断级与隐蔽级问题：

### 第一步：ZIP 归档清单与 `game/index.html` 脚本标签对账
- **操作方式**：用 Python 读取 `zipfile.ZipFile(zp).namelist()`，同时正则提取 `game/index.html` 中所有 `<script src="...">` 路径，做集合差集比对。
- **发现的问题**：
  1. `game/index.html` 引用了 `js/world-worker.js` 和 `js/trading.js`，但原 ZIP 包的 `game/js/` 目录下完全不存在这两个文件（根因见第 2 节“沙箱 FUSE `os.walk` 隐身陷阱”）。
  2. 独立附件命名为 `world_worker.js`（下划线 `_`），而 `game/index.html` 加载的是 `js/world-worker.js`（连字符 `-`）。若直接按原文件名放入目录，浏览器仍会报 `404 Not Found`。

### 第二步：全量 `unified_diff` 逐行静态对比（拒绝盲信黑盒测试）
- **操作方式**：对修改过的全部核心文件（如 `render.js`、`mesher.js`、`world.js`、`game.js`、`ui.js`）运行 `difflib.unified_diff` 或 `git diff`，逐行审查所有非预期改动。
- **发现的致命问题**：在 `game/js/render.js` 第 136 行发现了一处与 W0-C / W1 需求无关的改动：
  ```javascript
  // 原正确代码：
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  // 被误改后的代码（浏览器启动必崩）：
  if (!gl.getShaderParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  ```

### 第三步：还原“为什么测试脚本没报错，反而诱导改坏生产代码”的根因
- **根因剖析**：为什么协作 Agent 会去把第 136 行的 `gl.getProgramParameter` 改成 `gl.getShaderParameter`？看看 `render.js` 第 136–139 行就一目了然：
  ```javascript
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name] = gl.getUniformLocation(p, info.name); }
  ```
  - 第 136 行传入 `gl.LINK_STATUS`，期望返回布尔值 `true`；
  - 第 138 行同样调用 `gl.getProgramParameter`，传入 `gl.ACTIVE_UNIFORMS`，期望返回整数 `0`（若返回 `true`，在 `i < true` 即 `0 < 1` 时会进入循环调用未 Mock 的 `gl.getActiveUniform(p, 0)` 报错 `Cannot read properties of undefined (reading 'name')`）。
  - 协作 Agent 在写 Node 测试桩时，为了省事把 `getProgramParameter` 写成了固定返回 `0`（`() => 0`），导致第 136 行 `!0 === true` 抛异常；随后为了跳过报错，竟把生产代码第 136 行改成了返回 `true` 的 `gl.getShaderParameter(p, gl.LINK_STATUS)`！
  - 在真实浏览器的 WebGL2 中，`p` 是 `WebGLProgram` 而非 `WebGLShader`，调用 `gl.getShaderParameter(p, ...)` 会立即触发 `GL_INVALID_OPERATION` 并返回 `null`，导致整个游戏在启动阶段直接崩溃黑屏。
- **核心铁律**：**永远不要为了迁就简陋的测试 Mock 去修改正确的生产 WebGL/DOM 代码！** 正确的 WebGL2 Mock 应当按 `pname` 区分返回值并校验对象类型（见 `tools/verify_all.js`）：
  ```javascript
  createShader: (t) => ({ __type: 'shader', t }),
  getShaderParameter: (s, pname) => {
    assert(s && s.__type === 'shader', 'gl.getShaderParameter called with non-shader!');
    return true;
  },
  createProgram: () => ({ __type: 'program' }),
  getProgramParameter: (p, pname) => {
    assert(p && p.__type === 'program', 'gl.getProgramParameter called with non-program!');
    if (pname === 0x8B86) return 0; // gl.ACTIVE_UNIFORMS
    return true;                    // gl.LINK_STATUS
  },
  ```

### 第四步：跨模块符号与数据字典契约对账
- **操作方式**：检查新增模块（如 `trading.js`）引用的全局常量、键名和对象字段是否与既有模块（`enchant.js`、`ui.js`、`game.js`）严格对齐。
- **在补充文件 `trading.js` 中发现并顺手修复的 3 处细节问题**：
  1. **未注册附魔键 `'mending'`**：`trading.js` 第 77 行图书管理员附魔书随机池写了 `['sharpness', ..., 'looting', 'mending']`，但 `game/js/enchant.js` 的 `ENCHANTS` 表中并未定义 `'mending'`（全表共 19 种附魔，含 `'silk_touch'`、`'infinity'` 等）。一旦随机到 `'mending'`，附魔书 Tooltip 会显示生硬的英文 `'mending 1'` 且无法在铁砧上合成。现已将其修正为已注册的 `'silk_touch'`。
  2. **`VILLAGER_LEVELS` 导出缺失**：`ui.js` 第 997 行（`TradingScreen.prototype.drawExtra`）通过 `typeof VILLAGER_LEVELS !== 'undefined'` 读取当前等级经验下限绘制经验条，但 `trading.js` 只定义了 `VILLAGER_LEVEL_THRESHOLDS = [0, 10, 30, 70, 150]`。现已在 `trading.js` 同步导出 `VILLAGER_LEVELS` 结构数组。
  3. **漏斗冷却字段名 `cd` vs `cooldown`**：`game.js:465` 初始化漏斗实体时使用 `{ ..., cd: 0 }`，而 `trading.js` 的 `Hopper` 使用 `be.cooldown`。现已统一同步 `be.cooldown = be.cd`，确保两边读写一致。

### 第五步：双 VM 上下文（主线程 + 独立内联 Worker Context）端到端回归
- **操作方式**：在 Node.js 中不仅为游戏主线程创建 `vm.createContext`，还拦截 `new Blob([code])` 与 `new Worker(blobUrl)`，为内联 Worker 源码创建**完全独立的第二个 `vm.createContext`**（仅注入纯计算 API，不注入 DOM / WebGL / 主线程 `window`），真实模拟 `postMessage` 异步消息传递与 `Transferable` 缓冲交接。

## 2. Gemini Task 沙箱（VM）的 5 个环境陷阱与避坑指南

| 沙箱陷阱 | 现象与危害 | 标准解决方案（已沉淀至 `tools/`） |
|---|---|---|
| **陷阱 1：FUSE 文件系统 `os.walk` / `readdir` 新文件隐身 Bug** | 在解压出的目录（如 `game/js/`）下新建文件后，`os.path.exists('game/js/trading.js')` 为 `True`，但 `ls game/js/` 或 Python `os.walk()` **列不出新文件**，导致常规打包脚本静默漏文件 | 1. 新建文件后立即执行 `git update-index --add <file>`；<br>2. 打包一律运行 `python3 tools/package_project.py`（合并 `os.walk` + `git ls-files` + `index.html` 脚本清单并做入包断言） |
| **陷阱 2：无 `zip` CLI、无外网、`/tmp` 跨会话易失** | 沙箱禁用 `apt/pip/npm` 与外网；且对话上下文压缩或容器重连后 `/tmp` 会被清空 | 打包用 Python `zipfile`（`tools/package_project.py`）；测试脚本一律保存在仓库内 `tools/verify_all.js`，不要只放 `/tmp` |
| **陷阱 3：无硬件 GPU / Headless 浏览器 WebGL2 受限** | 在容器内直接跑 Chromium 常因缺少 GPU/WebGL2 上下文而无法进入游戏主循环 | 使用 `node tools/verify_all.js` 在 Node `vm` 中通过 `Proxy` 模拟 WebGL2 + Canvas2D + IndexedDB + Inline Worker，2 秒完成全链路验收 |
| **陷阱 4：Node `vm` 跨 Realm 的 `instanceof` 与全局词法作用域** | 1. 顶层 `const`/`let`/`class` 不会自动成为 `window.X` 属性；<br>2. 跨 `vm` 传过来的 `Uint16Array` 在主 Realm 执行 `instanceof Uint16Array` 可能因构造函数不同需要注意 | 在代码中使用 `typeof X !== 'undefined'` 判断全局模块；对跨上下文缓冲区可结合 `ArrayBuffer.isView(arr)` 或同 Realm 包装 |
| **陷阱 5：`save.js` 的 IndexedDB 请求与游标契约** | `DB.tx` 用 `'onsuccess' in r` 判断请求对象（若 Mock 空对象 `{}` 会跳过回调绑定）；`loadChunks` 使用 `IDBKeyRange.bound` 与 `s.openCursor` | 直接复用 `tools/verify_all.js` 中已经调通的 `indexedDBMock` 与 `IDBKeyRange.bound` 实现 |

## 3. 本项目（OpusMC / htgame）核心架构不变量

### 3.1 方块与物品 ID 分区表（严禁越界或冲突）

| ID 区间 | 用途 | 约束规则 |
|---|---|---|
| `0 .. 255` | 既有经典方块（石头、草方块、红石、结构方块等） | 编号已冻结，严禁重排或修改既有 ID 含义 |
| `256 .. 511` | 独立物品专属区间（木棍、矿锭、工具、盔甲、附魔书、刷怪蛋） | `defBlock` 已设置硬拦截，**严禁注册落在此区间的方块 ID** |
| `512 .. 1023` | 新增高 ID 方块区间（如 `512: prismarine_bricks`，`513: hopper`） | W1/W2/W3 新增方块（酿造台、比较器、侦测器、活塞、樱花木、下界与末地方块）一律从 **`514` 起顺序分配** |
| `1024+` | 独立物品溢出区间 | 新增药水、烈焰棒、末影珍珠、末影之眼等独立物品通过 `defItem` 自动分配 |
| `it.iconIdx` | 紧凑递增图标槽位（`0 .. N-1`） | `render.js` 的 `buildIcons()` 与 `ui.js` 的 `drawItem()` 必须只用 `it.iconIdx`，禁止用稀疏的 `it.id` 计算图集坐标 |

### 3.2 内联 Worker（`game/js/world-worker.js`）同步铁律
`world-worker.js` 采用 `fn.toString()` 将主线程的生成与网格构建函数序列化到 Blob Worker 中。因此：
1. **新增方块模型/碰撞箱函数必同步**：每当在 `blocks.js` 中新增自定义模型或碰撞箱函数（例如后续的 `brewingStandModel`、`comparatorModel`、`pistonModel`），**必须同步做两件事**：
   - 将该函数名加入 `world-worker.js` 的 `_buildWorkerScript()` 中的 `fnList` 数组；
   - 在 `world-worker.js` 的 `applyBlocksBootstrap` 函数中补充该方块 `b.key` 或标志位对应的 `b.model = ...` / `b.boxes = ...` / `b.texFn = ...` 绑定。
2. **严禁 Transfer 主线程活跃区块数组**：向 Worker 发送 `mesh` 任务时，只能把 `Mesher.gatherSnapshot(w, cx, sy, cz)` 创建的独立 $18^3$ 快照缓冲放入 Transferable 列表；**严禁将 `ch.blocks.buffer` 或 `ch.light.buffer` 放入 Transferable**，否则主线程区块数据会被立即置空（detached）。
3. **跨区块光照留在主线程**：Worker 的 `generate(cx, cz)` 只做纯单区块地形与结构摆放；收到 `generated` 消息挂载进 `w.chunks` 后，由主线程调用 `w.initLight(ch)` 和 `spawnAnimals(ch)`。

### 3.3 3D 变换矩阵与模型朝向约定（`util.js` / `render.js` / `entity.js`）
1. **模型局部坐标系**：所有生物与实体模型在局部空间中**正面朝向 `-Z`**，背面为 `+Z`，右侧为 `+X`，上方为 `+Y`。
2. **手臂平举方向**：在 `entity.js` 的 `pose()` 中，绕 X 轴正旋转 **`rx: +Math.PI / 2`** 才是将手臂向前平举（朝 `-Z`，如僵尸、村民的手臂）；负值 `-Math.PI / 2` 会把手臂向背后翻折。
3. **朝向目标的水平偏航角 `yaw`**：由于正面是 `-Z`，计算从点 $(x_0, z_0)$ 面向目标 $(x_1, z_1)$ 的 `M4.rotY` 角度应使用 `Math.atan2(-(x1 - x0), -(z1 - z0))`（如附魔台上的 3D 浮空书面向玩家）。

### 3.4 资源包烘焙（`tools/build_from_pack.py`）与 Alpha 通道陷阱
1. **唯一资源入口**：新增方块/物品/实体/GUI 贴图时，修改 `tools/build_from_pack.py` 的白名单并运行 `python3 tools/build_from_pack.py`，自动重新生成 `game/js/assets.js`。切勿手动拼接 Base64。
2. **PBR Alpha 通道清洗（`sanitize_tile_alpha`）**：`Pixel Perfection Legacy 13.21.2.zip` 将大量实心方块贴图的 `alpha < 255` 用作 PBR 高光或发光强度。若不清洗，在 `cutout` 渲染（`alpha < 0.5 discard`）或物品栏 3D 图标渲染时会变成半透明甚至全透明镂空！
   - 实心方块贴图：默认由 `sanitize_tile_alpha()` 强制将 `alpha` 设为 `255`；
   - 镂空贴图（树苗、花草、火把、铁轨、蜘蛛网、刷怪笼等）：必须加入 `CUTOUT_TILES` 白名单，将其二值化为 `0` 或 `255`。
3. **非完整立方体模型（`SH_MODEL`）UV 对齐**：部分特殊贴图（如 `bell_side`、`anvil_top`）只有局部像素区域非透明，编写 `SH_MODEL` 的 `faces: { up: [u0, v0, u1, v1, tex], ... }` 时，先用 Python 检查贴图的非透明像素包围盒（bbox），确保 UV 落在实心像素区内。

## 4. 标准开发、验证与打包 SOP 命令速查

每次完成一个阶段的代码修改后，请按顺序执行以下 3 条命令，全部显示 `[PASS]` 后再交付：

```bash
# 1. 将所有新建或修改的文件登记到 Git 索引（防止 FUSE readdir 漏文件）
git add -A && git update-index --add game/js/*.js docs/*.md tools/*

# 2. 运行全栈自动化验证套件（约 2 秒完成语法、WebGL2 API 审计、Worker、存档、交易与漏斗闭环测试）
node tools/verify_all.js

# 3. 使用防 FUSE 漏文件的打包脚本生成完整项目 ZIP（自带 index.html 脚本入包强校验）
python3 tools/package_project.py
```

## 5. 下一步研发目标（W1 收尾 → W2 自动化与樱花林）

当前 **W0（`Uint16` + 紧凑 `iconIdx` + 冷区块淘汰 + 存档导入导出 + 单 Worker 卸载）** 与 **W1 前半程（村民 3 职业交易系统 + 漏斗自动熔炉闭环）** 已全部合入并通过 `tools/verify_all.js` 验收。接下来的开发顺序建议如下：

| 阶段 | 任务项 | 核心验收标准 |
|---|---|---|
| **Step 5（W1 收尾）** | **基础酿造台 + 4 种核心药水 + 水下游泳姿态 + 副手盾牌** | 1. 实装酿造台（ID `514`）与玻璃瓶/水瓶/粗制药水及治疗、抗火、迅捷、夜视 4 种药水与状态效果计时；<br>2. 水下按冲刺键进入游泳姿态与流畅上浮/下潜；<br>3. 实装盾牌（右键举盾减免正面近战与箭矢伤害） |
| **Step 6（W2）** | **红石比较器 + 侦测器 + 普通/黏性活塞 + 樱花树林群系** | 1. 比较器读取容器（箱子/熔炉/漏斗）满度输出 `0..15` 信号；<br>2. 侦测器检测方块状态变化发出单刻脉冲；<br>3. 普通/黏性活塞遵守 **12 格推动上限与不可推动黑名单（防护规则 #4）**；<br>4. 新增樱花树林（Cherry Grove）群系与樱花原木/树叶/木板/花瓣小套装 |
| **Step 7（W3）** | **单活维度切换 + 精简下界与要塞 + 末影龙终局 Boss 战** | 遵循**单活维度切换架构（防护规则 #5）**，走通“黑曜石下界传送门 → 下界要塞烈焰人 → 末影之眼定位要塞 → 末地岛摧毁水晶并击败末影龙”完整生存闭环 |
