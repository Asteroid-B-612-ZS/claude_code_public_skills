# inbox-organizer Skill

Obsidian 每日整理工具，覆盖收件箱处理、日志分析、项目更新、系统控制台维护的完整工作流。

## 功能

- **收件箱处理**：扫描、分类、成本入库、归档
- **日志分析**：从每日日志提取【项目】【任务】【成本】标记
- **项目文件管理**：基于模板创建、增量更新时间线和任务状态
- **系统控制台维护**：更新 `_dashboard.md` 的全局状态
- **操作日志**：append-only 写入 `_log.md`
- **成本数据识别**：写入待审核 Excel（复用 cost-engineering pending 流程）
- **自动归档**：处理完毕的笔记及附件自动移至备份目录

## 触发方式

在 Claude Code 中说：

- "整理收件箱"
- "整理 inbox"
- "处理收件箱"
- "CC笔记整理"
- "收件箱归档"
- "整理今天日志并更新系统"
- "每日整理"

## 处理流程

```
读取 _dashboard.md (Step 0)
       ↓
00_收件箱 (Step 1-6)
  ├─ 成本型 → cost-engineering pending → 待审核_*.xlsx
  ├─ 笔记型 → 摘要写 _dashboard.md
  └─ 混合型 → 分别处理
→ 标记已入库 → 移至 50_收件箱备份
       ↓
分析当日日志 (Step 7) → 提取【项目】【任务】【成本】标记
       ↓
更新/创建项目文件 (Step 8) → 20_工程项目/*.md
       ↓
更新 Dashboard (Step 9) → 50_系统/_dashboard.md
       ↓
追加操作日志 (Step 10) → 50_系统/_log.md
```

## 铁律

1. 不修改 `🧾 个人笔记/项目笔记` 区域
2. 只写入 `🤖 AI整理区` 和系统文件（`_dashboard.md`、`_log.md`）
3. 模板文件不修改
4. 成本数据必须走 pending 通道
5. 系统文件增量更新，`_log.md` 禁止修改/删除历史
6. 不修改 `🧾 项目笔记` 区域，只更新 AI 维护区

## 依赖

- `cost-engineering` skill — 成本数据 pending/commit 流程
- Obsidian vault 路径：`D:\iCloudDrive\iCloud~md~obsidian\QiZhi库\`

## 安装

```powershell
cd C:\Users\qizhi\.claude\skills\inbox-organizer
powershell -ExecutionPolicy Bypass -File install.ps1
```

## 版本历史

| 版本 | 日期 | 说明 |
|------|------|------|
| V2.0 | 2026-04-21 | 增强为完整每日整理工作流：新增日志分析、项目更新、Dashboard维护、操作日志 |
| V1.0 | 2026-04-20 | 初始版本，6步自动化整理流程 |
