# inbox-organizer Skill

Obsidian 收件箱自动整理工具，将移动端收集的碎片化信息分类处理。

## 功能

- **成本数据识别**：从收件箱笔记中提取价格信息，写入待审核 Excel（复用 cost-engineering pending 流程）
- **日常笔记整理**：非成本内容整理到对应日期日志的 AI 板块
- **自动归档**：处理完毕的笔记及附件自动移至备份目录
- **去重保障**：复用 cost-engineering 三层去重机制

## 触发方式

在 Claude Code 中说：

- "整理收件箱"
- "整理 inbox"
- "处理收件箱"
- "CC笔记整理"
- "收件箱归档"

## 处理流程

```
00_收件箱 (待整理)
  ├─ 成本型 → cost-engineering pending → 待审核_*.xlsx
  ├─ 笔记型 → 10_每日日志/{date}.md AI板块
  └─ 混合型 → 分别处理
→ 标记已入库 → 移至 50_收件箱备份
```

## 铁律

1. 不修改 `🧾 个人笔记` 区域
2. 只写入 `🤖 AI总结` 区域
3. 日志模板不修改
4. 成本数据必须走 pending 通道

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
| V1.0 | 2026-04-20 | 初始版本，6步自动化整理流程 |
