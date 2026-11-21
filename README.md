# Solstice — GoldenHour

适用于 [GoldenHour](https://www.bilibili.com/toy/golden-hour/index.html) 网页小游戏的浏览器扩展（Chrome / Edge，Manifest V3）。
纯前端实现，面板用 Canvas 自绘，跑在游戏页面的 MAIN world 里。

## 安装

1. 打开 `edge://extensions`（或 `chrome://extensions`），开启「开发人员模式」
2. 「加载解压缩的扩展程序」→ 选择本仓库根目录
3. 打开游戏页，按 `Insert` 开关clickgui

## 功能

| 分类 | 模块 |
|---|---|
| Combat | AimBot、TriggerBot、Aura、NoRecoil、**InfiniteAmmo 无限子弹** |
| Movement | Sprint、NoJumpDelay、**Speed 加速**、**NoSlowdown 无减速** |
| Player | AntiAim（含 Derp Mode 陀螺）、CustomName |
| Visual | ESP、Arraylist、Watermark、ClickGui（Sol / Fatality 双风格）、HudEditor、Keystrokes、Notifications、Fatality 注入动画、ThirdPerson 第三人称 |
| Misc | Config 配置面板、InputGuard 输入守卫、UnLock、ToggleSounds |

### ClickGui 风格

`ClickGui → Style` 有两套，默认 `Sol`：

- **Sol**：分类悬浮窗，拖拽 + 滚轮，原来的样子
- **Fatality**：移植自 [BanCN-Re/FatalityClickGui](https://github.com/BanCN-Re/FatalityClickGui)
  —— 炭黑平铺窗口 + 珊瑚红点缀（`#151515`/`#1C1C1C`/`#FF615A`），左侧分类栏、
  三列瀑布流模块卡片、勾选框 / 滑条 / 下拉 / 色块行，配色与尺寸取自其 `FaTheme.java`

### 玩法模块

- **Speed**：把 `world.move` 的 `forward/right` 按倍率放大（1.0–4.0），并顺带顶住玩家速度系数；
  移动指令读完后立刻还原输入，别人看到的还是正常速度
- **NoSlowdown**：清 `arsenal.sprintLock`、骗过 `blocksSprint` 的 `sinceFire`，
  可选清 ADS/移动减速系数 —— 开枪和开镜时不再掉速
- **InfiniteAmmo**：这个游戏的枪是客户端模拟的，直接把 `arsenal.slot.ammo` 顶到容量、
  取消 `state === 'reloading'`、补满备弹；容量字段自动探测，可用 `Debug Dump` 打印真实字段名

### Fatality 注入动画

时间轴照抄 [addosama/FatalWidgets](https://github.com/addosama/FatalWidgets) 的 `InjectAnimation`：
`F` 从下方升到屏幕中央 → 横向滑到词首 → `ATALITY` 淡入上浮 → 黑幕 `0x88000000` 淡出，总长 3.55s。
文字是横向渐变 `#FF8080 → #CC3333`，可选 Glitch / Scanlines / Grain / 进度条 / 骷髅排。

### 配置系统

- 启动第一步就恢复上次激活的配置（模块开关、全部设置、按键绑定、HUD 坐标）
- 首次启动自动建立 `Default`，并镜像到 `Downloads/Solstice/Default.cfg`
- `Config` 面板：Save / Load / Delete / Export / Import / Open Folder，1.2s 自动保存
- 控制台：`sol("config save main")`、`config load`、`config folder`、`config export`

### 输入守卫

- 绑定串带修饰键前缀，绑 `A` 不会被 `Ctrl+A` 误触
- `Ctrl / Alt / Win` 组合拒绝绑定（浏览器保留键），只允许普通键 / `Shift+组合` / `Mouse3-5`
- 游戏内吞掉 `Ctrl / Alt / Win` 与侧键（顺手禁掉鼠标「后退」误触）
- `Guard Close`：局内关页面前弹确认

### 第三人称 / Derp Mode

- `ThirdPerson`：绑键切换，只在渲染瞬间把相机推到身后再立刻还原，射线与命中判定不受影响
- `AntiAim → Derp Mode`：服务端视角低头 + 陀螺旋转，本地第一人称不受影响（开第三人称才能看见自己转）

## 目录

```
background.js            service worker：配置文件写入 / 定位文件夹
extension/               协议、隔离世界桥、页面注入、游戏 iframe 桥
js/core.js               Canvas UI 内核（字体、圆角、主题、HUD 布局）
js/main.js               主循环与输入
js/config.js             配置引擎（localStorage + 磁盘镜像）
js/commands.js           控制台命令与按键绑定
modules/                 各功能模块
preview/                 本地验证台（逐帧渲染、配置 / 按键 / 相机单测）
```

## 本地验证

```sh
node preview/server.js          # http://127.0.0.1:8791/preview/
node preview/bgtest.mjs         # 后台 service worker 单测
```

- `preview/preview.html?t=1.45` 定格注入动画任意一帧
- `preview/configtest.html` 配置 / HUD / 按键快照往返
- `preview/tptest.html` 第三人称相机推拉
- `preview/keytest.html` 修饰键匹配、侧键、关页确认
- `preview/watermarktest.html` Watermark 两种风格 + 渲染循环容错
- `preview/guipreview.html?style=fatality&cat=Visual` Fatality 风格 ClickGui 定格渲染
- `preview/gametest.html` Speed / NoSlowdown / InfiniteAmmo 游戏侧行为

## License

Apache-2.0
