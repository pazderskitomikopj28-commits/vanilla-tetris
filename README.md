# Vanilla Tetris · 零依赖俄罗斯方块

> 「个人项目积累」第一期：复刻并改进 GitHub 上经典的 **Guideline 俄罗斯方块**。
> 纯原生 HTML / CSS / JavaScript，**零框架、零依赖、零构建**，克隆即玩。

![vanilla](https://img.shields.io/badge/dependency-0-brightgreen) ![license](https://img.shields.io/badge/license-MIT-blue)

## 玩法 / 试玩

直接双击 `index.html` 即可开始。也可以到展示站在线体验：[个人项目积累 · 互动实验室](../../index.html)。

| 操作 | 键盘 | 触屏 |
| --- | --- | --- |
| 移动 | `←` `→`（支持 DAS/ARR 按住连发） | 左右按钮（长按连发） |
| 软降 | `↓` | `↓` 按钮 |
| 旋转 | `↑` / `X` 顺时针，`Z` 逆时针 | `⟳` 按钮 |
| 硬降 | `空格` | `⤓` 按钮 |
| 暂存 | `C` / `Shift` | `H` 按钮 |
| 暂停 / 重开 | `P` / `Esc` · `R` | 屏上按钮 |

## 实现了哪些「Guideline」规则

参考 Tetris Guideline 与 GitHub 上众多开源实现（SRS 踢墙表、7-Bag 随机器等均有成熟范式）：

- **SRS 超级旋转系统**：完整 J L S T Z / I 两套踢墙表，支持各种踢墙入槽
- **7-Bag 随机器**：7 种方块洗牌成一袋，手感公平
- **Hold 暂存**、**Next ×5 预览**、**幽灵方块**（落点投影）
- **锁定延迟**：落地后 500ms 缓冲，移动/旋转可重置（上限 15 次）
- **DAS/ARR 横移手感**：150ms 延迟 + 40ms 连发
- **计分系统**：单行/双行/三行/Tetris、软降硬降加分、**连击 Combo**、**Back-to-Back ×1.5**、**T-Spin 三角判定**（含 Mini 与踢墙转体判定）
- **等级加速曲线**：`(0.8 - (lvl-1)×0.007)^(lvl-1)` 秒/行，每 10 行升级

## 在复刻之上，我们自己的改进

1. **Web Audio 芯片音乐**：手写音序器循环播放《Korobeiniki》（方波主旋律 + 三角波贝斯，lookahead 调度），可独立开关
2. **全套合成音效**：移动 / 旋转 / 踢墙 / 锁定 / 消行 / Tetris 和弦 / 升级琶音 / 游戏结束
3. **消行粒子特效 + 硬降屏幕微震**（尊重 `prefers-reduced-motion` 自动关闭）
4. **完整中文界面**与键盘 / 触屏双操控
5. **最高分持久化**（LocalStorage），破纪录有专属庆祝文案
6. **零依赖**：不引入任何库，构建产物就是源码本身
7. `window.__tetris` 调试接口：状态机与棋盘可编程访问，方便自动化测试

## 目录结构

```
tetris/
├── index.html        # 页面结构
├── css/style.css     # 样式（与主站同一套设计语言）
├── js/audio.js       # 芯片音乐音序器 + 合成音效
├── js/game.js        # 游戏引擎（规则 / 物理 / 渲染 / 输入）
└── README.md
```

## 本地运行

无需任何安装，双击 `index.html` 即可；或起一个静态服务器：

```bash
python -m http.server 8000
# 打开 http://localhost:8000
```

## License

MIT · 复刻与改进产物，仅供学习交流。俄罗斯方块玩法版权归 The Tetris Company 所有。
