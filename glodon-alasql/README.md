# Glodon-AlaSQL

广联达清单计价 Excel 报表分析工具 — Claude Code Skill

基于 [AlaSQL](https://github.com/AlaSQL/alasql) 构建，专门解析广联达造价软件导出的投标清单 Excel 文件，提供智能 Sheet 解析、数据清洗、统一数据视图和预设造价分析功能。

## 致谢

本项目的底层 Excel 读取和 AlaSQL 集成能力来源于 [excel-alasql](https://github.com/ferocknew/claude_code_public_skills/tree/main/excel-alasql) 项目（[claude_code_public_skills](https://github.com/ferocknew/claude_code_public_skills) 仓库），在此基础上进行了广联达造价报表的专业化扩展。

## 功能特性

- **智能 Sheet 解析**：自动识别广联达导出的 C.1~C.15 标准报表体系，处理 Sheet 名称截断、同名分部后缀等边界情况
- **自动单位工程归属**：通过 C.5 汇总表的层级结构，自动将 C.6 分部分项表归属到正确的单位工程
- **数据清洗引擎**：过滤表头行、提取分部标题、标准化项目编码
- **统一数据视图**：所有 C.6 表合并为一张 `bq_items` 内存表，支持 SQL 查询
- **预设分析模块**：同清单比价、关键词搜索、编码分类汇总、全费用计算、修改前后对比

## 安装

```bash
# 克隆到 Claude Code 的 skills 目录
cd ~/.claude/skills
git clone https://github.com/<your-username>/glodon-alasql.git
cd glodon-alasql
npm install
```

## 使用方法

```bash
# 数据概览
node skill.js "D:/data/某某某工程.xlsx"

# 同清单比价分析
node skill.js "D:/data/某某某工程.xlsx" compare-prices

# 按关键词搜索清单
node skill.js "D:/data/某某某工程.xlsx" search "混凝土"

# 按编码前缀汇总（0105 = 混凝土工程）
node skill.js "D:/data/某某某工程.xlsx" summary --prefix "0105"

# 全费用价格计算（含措施费、税金分摊）
node skill.js "D:/data/某某某工程.xlsx" full-cost

# 修改前后对比
node skill.js "D:/data/修改前.xlsx" diff "D:/data/修改后.xlsx"

# 自定义 SQL 查询
node skill.js "D:/data/某某某工程.xlsx" "SELECT code, name, price FROM bq_items WHERE price > 1000 LIMIT 20"
```

## SQL 列名映射

AlaSQL 不支持中文列名，查询时使用英文别名：

| 英文列名 | 中文含义 |
|---------|---------|
| code | 项目编码 |
| name | 项目名称 |
| unit_project | 单位工程 |
| division | 分部工程 |
| unit | 计量单位 |
| qty | 工程量 |
| price | 综合单价 |
| amount | 合价 |
| labor | 人工费 |

查询结果会自动翻译为中文显示。

## 支持的报表类型

| 编号 | 报表名称 | 说明 |
|------|---------|------|
| C.4 | 汇总表 | 项目级费用汇总 |
| C.5 | 单位工程清单汇总表 | 每单位工程1个 |
| C.6 | 分部分项工程计价表 | 每分部工程1个（核心数据） |
| C.8 | 措施项目清单汇总表 | 全项目措施费 |
| C.15 | 增值税计价表 | 与C.6一一对应 |

## 技术栈

- [AlaSQL](https://github.com/AlaSQL/alasql) v4.17.0 — JavaScript SQL 数据库
- [SheetJS](https://github.com/SheetJS/sheetjs) v0.18.5 — Excel 文件解析

## 许可证

MIT
