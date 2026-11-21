# PhysLab

基于 AI 的高中物理模拟实验台——**板块模型、传送带模型、碰撞相遇、人船模型、例题拼合**，现已升级为 **可用 Electron 封装的桌面程序** 和 **插件化平台（插件市场）**。

> 仓库：<https://github.com/liuchenxuan/PhysLab> · 插件仓库：<https://github.com/liuchenxuan/PhysLab-plugin>

## 功能

原版全部功能完整保留（解析解逐过程模拟、2D/3D 动画、多图联动、红旗标记、任意时刻测量与反查、解题过程、参数扫描、AI 说题即模拟 / 校验 / 出题 / 对话、导出备份 / 网页 / Word / CSV……）。在此基础上新增：

| 新增 | 说明 |
| --- | --- |
| **插件市场** | 顶部导航“插件市场”：浏览、安装、更新、启停、卸载插件；支持导入本地插件、从 URL 安装；离线时使用内置副本 |
| **两类插件** | **Official 官方插件**（维护者审核）与 **Users 用户插件**（社区提交） |
| **五类扩展** | ① 新增模块（如电磁）② 新增图表类型 ③ 新增变量与计算公式 ④ 修正或新增计算结果 ⑤ 增加或修正 AI 功能 |
| **桌面程序** | `electron/` 文件夹提供 Electron 封装（Windows / macOS / Linux） |
| **安全模式** | 地址加 `?safe`（桌面版：视图 → 安全模式重新加载）跳过全部插件 |

## 内置的官方插件（`indexplugin/official/`）

| 插件 | 范畴 | 内容 |
| --- | --- | --- |
| `electromagnetism` 电磁学模块 | 模块 · 图表 · 变量 | 带电粒子在匀强电场 / 磁场（含 E×B 摆线）中的运动；导体棒切割磁感线（终极速度、焦耳热、电荷量） |
| `chart-pack` 图表扩展包 | 图表 | 相对速度、动量、相图折线图；能量分配柱状图（自绘） |
| `mechanics-variables` 力学变量与公式 | 变量 | 机械能增量、摩擦功率、总动量、能量账本、相对动能 |
| `energy-efficiency` 能量与效率分析 | 结果 | 传送带效率、总生热占比；修正“痕迹长度”提示；能量账本校验与解题步骤 |
| `ai-lab-assistant` AI 实验助手 | AI | “AI 实验报告”工具、强化校验提示词、追加 AI 上下文与快捷问题 |

用户插件示例：`indexplugin/users/projectile-demo/`（抛体运动）。

## 使用 AI 功能

打开“模型配置”，填写 DeepSeek / 智谱 GLM / 自定义 OpenAI 兼容接口的 API Key（保存在本机浏览器存储，不会写入导出的文件）。

## 插件市场如何工作

```
本程序（src/） ──读取──▶ https://raw.githubusercontent.com/liuchenxuan/PhysLab-plugin/main/indexplugin/index.json
                  └──失败时──▶ 随程序内置的 indexplugin/（构建时打包，离线可用）
```

- 在线与内置使用**同一目录结构**：`indexplugin/index.json` + `official/<id>/` + `users/<id>/`，每个插件含 `plugin.json` 与 `index.js`。
- 已安装插件的源码保存在本机；启动时在界面初始化前同步激活；增删插件后点“立即重新加载”生效。
- 使用了已卸载插件模块的配置**不会丢失**，重新安装后自动恢复。
- 导出“本配置网页 .html”时，会把当前配置所用的插件一并内嵌，对方无需安装即可打开。
- 国内网络可在“插件市场 → 仓库设置”改为镜像地址。

> 插件是运行在页面里的 JavaScript，请只安装信任的插件。

## 开发插件

| 文档 | 内容 |
| --- | --- |
| [`plugin-template/`](plugin-template/) | **插件模板文件夹**（可直接复制）：`plugin.json`、`index.js`、`pack.mjs`、类型提示、AI 技能文件 |
| [`docs/PLUGIN_DEVELOPMENT.md`](docs/PLUGIN_DEVELOPMENT.md) | 开发说明：清单、五类扩展的 API、`makeSim` 模块工具箱、调试与发布 |
| [`docs/skills/physlab-plugin-dev/SKILL.md`](docs/skills/physlab-plugin-dev/SKILL.md) | **AI 生成插件的 skill 文件**：把它交给 AI，即可按规范生成 `plugin.json` + `index.js` |
| [`docs/ELECTRON_PACKAGING.md`](docs/ELECTRON_PACKAGING.md) | Electron 封装教程（独立文档，不属于主程序） |

发布插件：把文件夹放进 `PhysLab-plugin` 仓库的 `indexplugin/users/<id>/`，运行 `node indexplugin/build-index.mjs` 更新目录，提交 Pull Request。

## 目录结构

```
PhysLab/
├─ index.html                 入口（含“导出网页”用的 embedded-config 占位）
├─ src/
│  ├─ main.tsx · App.tsx      React 外壳：挂载原界面 + 插件市场
│  ├─ core/                   PhysLab 内核（原 index.html 迁移而来，功能完整）
│  │  ├─ body.html · legacy.css · physlab.js   第 11 节为插件运行时与扩展点
│  ├─ plugins/                插件系统：types / manager / api / market（目录与下载）
│  └─ market/                 插件市场界面（React）
├─ indexplugin/               插件市场的内置副本（结构同 PhysLab-plugin 仓库）
├─ plugin-template/           插件模板
├─ electron/                  Electron 封装层（独立 package.json）
└─ docs/                      开发说明 · AI skill · 封装教程
```

## 许可证

GPL-3.0，见 [LICENSE](LICENSE)。
