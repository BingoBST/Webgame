# OpusMC — Browser WebGL2 Minecraft Replica

一个零依赖、无需构建、打开浏览器即可运行的单人 **Minecraft** WebGL2 复刻项目。全项目采用原生 JavaScript + WebGL2 + WebAudio 从零实现，贴图与 GUI 资源由 `tools/build_from_pack.py` 从 `Pixel Perfection Legacy 13.21.2.zip` 资源包自动构建生成（缺失部分自动回退至原版资源）。

---

## 1. 快速开始

```bash
git clone <repo-url>
cd OpusMC
```

1. **直接运行**：双击根目录下的 `启动游戏.bat`（或直接用 Chrome / Edge 打开 `game/index.html`），**零构建、零 npm 依赖**。
2. **本地服务器运行（推荐）**：双击 `启动游戏(本地服务器模式).bat` 或执行：
   ```bash
   python3 tools/serve.py
   ```
   浏览器访问 `http://localhost:8765/` 即可游玩（避免部分浏览器在 `file://` 协议下限制 IndexedDB 存储）。
3. **重新生成材质包资产**（可选，需 Python 3 + Pillow）：
   ```bash
   pip install pillow
   python3 tools/build_from_pack.py "/path/to/Pixel Perfection Legacy 13.21.2.zip"
   ```

---

## 2. 当前版本规模与已实装内容

| 维度 | 统计数量 | 说明 |
| :--- | :---: | :--- |
| **注册方块（非空气）** | **186** | 含基础地形、矿石、建筑、红石元件、结构专属方块、附魔台、铁砧等 |
| **可持有物品总数** | **276** | 175 种方块物品 + 101 种独立物品（工具、武器、盔甲、食物、附魔书、刷怪蛋等） |
| **合成与冶炼配方** | **124 / 19** | 支持 2×2 背包合成、3×3 工作台合成（含左侧一键配方书）与熔炉冶炼 |
| **附魔种类** | **19** | 涵盖近战武器、挖掘工具、全套盔甲、远程弓箭与通用耐久 |
| **生物与 AI** | **9** | 猪、牛、羊、鸡、村民（被动/繁殖）+ 僵尸、骷髅、苦力怕、蜘蛛（敌对/战斗） |
| **自然生成结构** | **4** | 地下刷怪笼地牢、村庄（平原/沙漠/雪原三风格）、沙漠神殿、废弃矿井 |
| **生物群系** | **12** | 平原、森林、桦木林、针叶林、雪原、沙漠、山地、雪山、河流、沙滩、海洋、冻洋 |
| **进度（成就）** | **19** | 从砍树、挖矿、红石工程到附魔师的完整生存引导链 |

### 核心系统亮点
- **WebGL2 渲染与平滑光照**：
  - `16×16×256` 区块柱与 `16³` 分段网格（Section Meshing）、视锥剔除、逐顶点平滑光照（天空光/方块光双通道 BFS 洪水填充）与环境光遮蔽（AO）。
  - 3 桶半透明分层渲染（侧面 → 底面 → 顶面），彻底解决冰水交界面的可见性与水下冰块立体体积渲染。
  - 昼夜交替、8 相位月相、星空、立体云层、动态雨雪、水下/熔岩雾效与暗角 Vignette 叠加。
- **世界结构生成（`game/js/structures.js`）**：
  - **村庄（Village）**：根据所在生物群系自动切换橡木/砂岩/云杉建筑风格，包含集会钟（5 段式立体模型）、农田、房屋、铁匠铺与常驻村民。
  - **沙漠神殿（Desert Pyramid）**：完整地上金字塔、雕纹/切制砂岩装饰、蓝色/橙色陶瓦图腾，以及地底隐藏的 4 宝箱 + 9 格 TNT 石质压力板陷阱密室。
  - **废弃矿井（Mineshaft）**：地下 `Y = 20..42` 的交错支道网络、木制支撑拱架、断续铁轨、矿道战利品箱、密集蜘蛛网与迷你旋转蜘蛛刷怪笼（持续喷发火焰与烟雾粒子并定期生成蜘蛛）。
  - 支持 `/locate village | desert_pyramid | mineshaft` 命令快速检索最近结构坐标并配合 `/tp` 一键传送。
- **附魔与铁砧系统（`game/js/enchant.js`）**：
  - **附魔台（ID 185）**：台面悬浮 3D 翻页典籍（靠近时书页正对玩家大角度展开），自动检测周围 2 格内最多 `15` 个书架（需中间空气无遮挡）并飘散符文流光粒子，提供最高 `30` 级的三档青金石附魔选项与悬停预览。
  - **铁砧（ID 186）**：5 段式 3D 模型、支持重力下落；实装原材料单元修复（每单位恢复 `25%` 耐久）、同类物品合并（附赠 `12%` 耐久奖励与同级魔咒升级）、附魔书魔咒赋予、互斥冲突检测、累积操作惩罚（Prior Work Penalty）与自定义物品命名。
  - **19 种附魔完整生效**：锋利、亡灵杀手、节肢杀手、击退、火焰附加、抢夺、效率、精准采集、时运、耐久、保护、火焰保护、爆炸保护、弹射物保护、摔落缓冲、水下呼吸、水下速掘、深海探索者、荆棘、力量、冲击、火矢、无限；附魔物品拥有严格的像素级 Alpha 遮罩动态紫光流光。
- **红石核心套件（`game/js/redstone.js`）**：
  - 红石线（0–15 级信号衰减、四向自动连接、1 格高低差爬坡）、红石火把（非门反相、2 刻延迟、防高频烧毁保护）、红石中继器（1–4 档延迟、二极管单向放大）、红石块、拉杆、石头/木质按钮、石头/木质压力板、标靶方块，可驱动红石灯、TNT、门、活板门与音符盒。

---

## 3. 操作说明与常用命令

| 按键 | 功能 |
| :--- | :--- |
| `W A S D` | 移动 |
| `Space` | 跳跃 / 游泳上浮 / 创造模式下双击切换飞行 |
| `Left Shift` | 潜行（防边缘掉落）/ 飞行下降 / 起床 |
| `Left Ctrl` 或双击 `W` | 疾跑 |
| 鼠标左键 | 挖掘方块 / 攻击生物 |
| 鼠标右键 | 放置方块 / 打开工作台、熔炉、箱子、附魔台、铁砧 / 摇钟 / 拉弓 / 进食 |
| 鼠标中键 | 选取目标方块 |
| `E` | 打开背包 / 创造模式物品栏（支持分类标签与中英文搜索） |
| `Q` / `Ctrl+Q` | 丢弃 1 个 / 整组手持物品 |
| `T` 或 `/` | 打开聊天框与命令输入（支持 `Tab` 自动补全与 `↑/↓` 历史记录） |
| `F1 / F3 / F5` | 隐藏 HUD / 显示调试信息（含目标方块红石状态）/ 切换第一、第三人称视角 |

### 内置调试与游玩命令
- `/enchant <附魔英文名> [等级]`：为手持物品或书附加附魔（如 `/enchant sharpness 5`、`/enchant silk_touch 1`）
- `/locate village | desert_pyramid | mineshaft`：定位最近的村庄、沙漠神殿或废弃矿井坐标
- `/tp <x> <y> <z>`：传送至指定坐标
- `/give <物品英文名> [数量]`：给予物品（如 `/give enchanting_table 1`、`/give anvil 1`、`/give lapis_lazuli 64`）
- `/gamemode creative | survival`：切换创造 / 生存模式
- `/xp <数量>`：增加玩家经验值
- `/time set day | night | noon`、`/weather clear | rain`、`/summon <生物名>`、`/clear`、`/seed`

---

## 4. 目录结构

```text
OpusMC/
├── game/
│   ├── index.html             # 游戏主入口（零构建直接运行）
│   └── js/
│       ├── assets.js          # 由 build_from_pack.py 生成的纹理图集与 GUI Base64 资源
│       ├── util.js            # 数学库（M4 矩阵、Simplex 噪声、RNG、RLE 编码）
│       ├── blocks.js          # 186 种方块、276 种物品、合成与冶炼配方注册表
│       ├── enchant.js         # 附魔注册表、附魔台算法、铁砧合成/修复/重命名与附魔效果计算
│       ├── world.js           # 区块数据结构、地形/生物群系/洞穴生成、流体与双通道光照
│       ├── structures.js      # 村庄、沙漠神殿、废弃矿井生成器与 /locate 空间检索
│       ├── mesher.js          # 16³ 区段网格构建器（SH_CUBE/SH_BOXES/SH_MODEL/SH_WIRE/SH_LIQUID）
│       ├── render.js          # WebGL2 渲染管线、天空/云层/天气、实体骨骼模型与 3D 物品图标生成
│       ├── entity.js          # 物理碰撞、玩家控制、9 种生物 AI、箭矢、掉落物与粒子系统
│       ├── redstone.js        # 红石信号传播网络、计划刻调度与受控用电器逻辑
│       ├── ui.js              # Canvas2D HUD、像素字体、背包/工作台/熔炉/箱子/附魔台/铁砧/创造界面
│       ├── save.js            # IndexedDB / localStorage 存档管理
│       ├── game.js            # 游戏主循环（20 TPS 固定步长 + 帧插值）、交互与存档协调
│       ├── screens.js         # 标题菜单、设置、进度、统计、帮助与命令解析器
│       └── main.js            # 键盘/鼠标事件绑定与入口初始化
├── tools/
│   ├── build_from_pack.py     # 从第三方资源包（Pixel Perfection Legacy）构建 assets.js
│   ├── build_assets.py        # 原版 jar 资源提取脚本
│   └── serve.py               # 本地零缓存静态 HTTP 服务器
├── docs/
│   ├── 01-current-state-audit.md  # 项目现状审计报告
│   └── 02-project-design.md       # 面向 1.20+ 的演进架构设计讨论
├── 启动游戏.bat
├── 启动游戏(本地服务器模式).bat
└── README.md
```

---

## 5. 开源许可与声明

- 本仓库的**源代码**（`game/js/` 下除 `assets.js`、`assets.vanilla.js` 以外的源码、`game/index.html`、`tools/`）基于 [MIT License](LICENSE) 开源。
- `game/js/assets.js` 中打包的贴图与 GUI 素材源自 `Pixel Perfection Legacy` 资源包及 Minecraft 官方素材，版权归原作者及 **Mojang Studios / Microsoft** 所有，仅供学习与技术演示使用。
