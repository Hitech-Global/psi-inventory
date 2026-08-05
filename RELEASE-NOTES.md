# Release Notes

## v1.0.6 — 欢迎页大标题/品牌名与售后系统统一
- 欢迎页大标题由硬编码 `PSI` 改为 `<h1 data-i18n="splash.title">`，中文渲染「你好」（与售后系统一致），英文「Hello」、印尼语「Halo」
- i18n.js 新增 `splash.title` / `splash.opening` / `app.title` 三语 key
- 欢迎页品牌行由 `PSI系统` 改为 `Hitech PSI`（与售后 `Hitech After-Sales` 命名风格对齐），使用 `data-i18n="app.title"`
- 欢迎页底部文案同步更新为「正在进入 Hitech PSI...」/「Opening Hitech PSI...」
- 部署范围仅含前端 i18n + index.html，不涉及后端业务逻辑

## v1.0.5 — 登录/欢迎页/侧边栏 logo 统一为售后系统品牌图
- 复制售后系统 `assets/brand/hnm-logo.png` 到本仓库 `assets/brand/`
- 登录页、欢迎页（splash）、侧边栏 brand-icon 三处 logo 由 `📦` emoji 改为引用同一张 `hnm-logo.png` 图片，与售后系统视觉一致
- 侧边栏 brand-icon 容器尺寸/样式对齐售后（`44×30` 透明、`object-fit:contain`），移除原绿色圆角方块
- 欢迎页 `showEnterSplash` 隐藏类由 `.hide` 改为 `.hidden`，与售后保持一致
- 欢迎页 CSS 与售后统一：浮动渐变背景、渐变文字标题 `clamp(76px,13vw,116px)`、`welcome-foot`、`prefers-reduced-motion` 兼容
- 部署范围仅含前端 UI（index.html / app.js / assets），不涉及后端业务逻辑（server.js / pg-async.js 等未在本次发布）

## 历史版本
- v1.0.4 — 销售导入库存重算解耦等（commit 5fdf7fb，已上线）
- v1.0.3 — 入口层统一到售后系统（登录页玻璃拟态 + 外壳毛玻璃 + 登录欢迎 splash）
- v1.0.2 — 见 git tag
- v1.0.1 — 见 git tag
