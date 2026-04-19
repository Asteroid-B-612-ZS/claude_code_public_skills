# Glodon-AlaSQL Skill

**skill_version**: 1.0.0
广联达清单计价 Excel 报表分析工具。基于 AlaSQL，专门解析广联达造价软件导出的投标清单 Excel 文件，提供智能 Sheet 解析、数据清洗、统一数据视图和预设分析功能。

## 触发条件

当用户的需求匹配以下**任一场景**时，应优先调用此 skill：

- 分析广联达（Glodon）造价软件导出的 Excel 报表
- 对投标清单进行比价、汇总、全费用计算、版本对比等造价分析
- 查询分部分项工程计价表、汇总表、增值税表等广联达标准报表数据
- 关键词：广联达、清单计价、分部分项、投标报价、综合单价、工程量清单

**不适用场景（使用 excel-alasql）**：
- 非广联达导出的普通 Excel 文件
- 需要写入/修改 Excel
- 文件超过 100MB 或数据行超过 5 万行

## 运行方式

```bash
# 位于 skill 目录下运行（需要 npm install 后的 node_modules）
cd ~/.claude/skills/glodon-alasql

# 数据概览
node skill.js <文件绝对路径>

# 同清单比价分析
node skill.js <文件绝对路径> compare-prices

# 按关键词搜索清单
node skill.js <文件绝对路径> search "关键词"

# 按编码前缀汇总（编码前缀含义见下方知识库）
node skill.js <文件绝对路径> summary --prefix "0105"

# 全费用价格计算（含措施费、税金分摊）
node skill.js <文件绝对路径> full-cost

# 修改前后对比（两个文件）
node skill.js <文件1路径> diff <文件2路径>

# 自定义 SQL 查询（列名用英文别名，见下方映射表）
node skill.js <文件绝对路径> "SELECT code, name, price FROM bq_items WHERE price > 1000 LIMIT 20"
```

**重要：** 请使用文件的**绝对路径**。

## 报表结构识别（通用标准）

本 Skill 自动识别广联达导出的标准报表体系（跨项目通用）：

| 报表编号 | 报表名称 | 说明 |
|---------|---------|------|
| C.1 | 封面 | 项目基本信息 |
| C.2 | 扉页 | 投标总价签章页 |
| C.3 | 填报说明 | 编制说明 |
| C.4 | 汇总表 | **1个**，项目级三层树形汇总 |
| C.5 | 单位工程清单汇总表 | **N个**，每单位工程1个，【】内为单位工程名 |
| C.6 | 分部分项工程计价表 | **N个**，每分部工程1个，【】内为分部工程名 |
| C.8 | 措施项目清单汇总表 | 1个 |
| C.8.1 | 安全文明施工明细表 | 1个 |
| C.10 | 暂列金额明细表 | 1个 |
| C.11 | 材料暂估价表 | 1个 |
| C.12 | 专业工程暂估价表 | 1个 |
| C.14 | 总承包服务费计价表 | 1个 |
| C.15 | 增值税计价表 | **N个**，与C.6一一对应 |

**关键规则**：
- C.5 的【】内容是**单位工程名称**（因项目而异）
- C.6 的【】内容是**分部工程名称**（因项目而异）
- C.6 同名分部用后缀 `_1`、`_2` 区分
- Excel Sheet名有31字符限制，长名称可能被截断（Skill已处理）

## 数据视图（AlaSQL 内存表）

### bq_items — 分部分项清单明细（核心表）

所有 C.6 Sheet 合并后的统一视图，每条记录附加"单位工程"和"分部工程"标签。

| 英文列名 | 中文含义 | 类型 |
|---------|---------|------|
| seq | 序号 | 文本 |
| code | 项目编码 | 文本（9-12位国标编码） |
| name | 项目名称 | 文本 |
| desc | 项目特征描述 | 文本 |
| work | 工作内容 | 文本 |
| unit | 计量单位 | 文本（m3/m2/m/t/项/套等） |
| qty | 工程量 | 数值 |
| price | 综合单价 | 数值（元） |
| amount | 合价 | 数值（元） |
| labor | 人工费 | 数值（元） |
| mat_est | 材料暂估价 | 数值（元） |
| remark | 备注 | 文本 |
| unit_project | 单位工程 | 文本（所属单位工程名） |
| division | 分部工程 | 文本（所属分部工程名） |

### 其他表

| 表名 | 说明 | 列 |
|-----|------|---|
| project_summary | C.4项目汇总 | seq, content, amount |
| unit_summaries | 单位工程汇总 | unit_project, division_count |
| measures | 措施项目 | seq, code, name, amount, remark |
| vat | 增值税 | sheet, unit, name, base, rate, amount |

## SQL 查询示例

```bash
# 各单位工程清单数量和造价
node skill.js file.xlsx "SELECT unit_project, COUNT(*) FROM bq_items GROUP BY unit_project"

# 综合单价最高的20条清单
node skill.js file.xlsx "SELECT code, name, unit_project, price FROM bq_items ORDER BY price DESC LIMIT 20"

# 同名清单不同价格（按名称+单位分组）
node skill.js file.xlsx "SELECT name, unit, MIN(price), MAX(price) FROM bq_items GROUP BY name, unit HAVING MIN(price) <> MAX(price) LIMIT 20"

# 按编码前缀查询（0105=混凝土工程）
node skill.js file.xlsx "SELECT code, name, SUM(qty), SUM(amount) FROM bq_items WHERE code LIKE '0105%' GROUP BY code, name ORDER BY SUM(amount) DESC LIMIT 20"

# 某单位工程下的所有清单
node skill.js file.xlsx "SELECT code, name, qty, price, amount FROM bq_items WHERE unit_project = '地下室' LIMIT 50"
```

**注意**：
- 列名必须使用**英文别名**（见上方映射表），不支持中文列名
- `amount` 代替 `total`（total 是 AlaSQL 保留字）
- `work` 代替 `content`（避免与 project_summary 的 content 列冲突）
- 建议始终使用 `LIMIT` 限制结果数量

## 国标清单编码分类知识库

项目编码的前缀对应固定的工程类别（跨项目通用）：

### 建筑与装饰工程（01xx）

| 前缀 | 工程类别 |
|------|---------|
| 0101 | 土石方工程 |
| 0102 | 地基处理与边坡支护工程 |
| 0103 | 桩基工程 |
| 0104 | 砌筑工程 |
| 0105 | 混凝土及钢筋混凝土工程 |
| 0106 | 金属结构工程 |
| 0107 | 木结构工程 |
| 0108 | 门窗工程 |
| 0109 | 屋面及防水工程 |
| 0110 | 保温、隔热、防腐工程 |
| 0111 | 楼地面装饰工程 |
| 0112 | 墙柱面装饰工程 |
| 0113 | 天棚工程 |
| 0114 | 油漆、涂料、裱糊工程 |
| 0115 | 其他装饰工程 |
| 0116 | 措施项目 |

### 安装工程（03xx/04xx/05xx/06xx/07xx/08xx/09xx）

| 前缀 | 工程类别 |
|------|---------|
| 0301 | 机械设备安装工程 |
| 0302 | 电气设备安装工程 |
| 0303 | 静置设备与工艺金属结构 |
| 0304 | 热力设备安装工程 |
| 0308 | 给排水工程 |
| 0309 | 暖通工程 |
| 0310 | 消防工程 |
| 0401 | 市政管网工程 |
| 0402 | 市政道路工程 |
| 0405 | 市政给排水工程 |
| 0501 | 园林绿化工程 |
| 0502 | 园路园桥工程 |

**编码结构**：`XXYYZZNNNN` → XX=专业代码, YY=分部代码, ZZ=分项代码, NNNN=顺序码

## 分析功能说明

### compare-prices（同清单比价）
- 以 `项目编码` 为主键，查找在不同单位工程中出现且综合单价不同的清单
- 输出按单价差异金额降序排列
- 显示每条明细的单位工程、工程量、单价、合价

### search（关键词搜索）
- 在项目名称、项目特征描述、项目编码中全文搜索
- 输出汇总统计（总工程量、总造价、平均单价）
- 按单位工程分组显示分布

### summary（编码前缀汇总）
- 按项目编码前缀筛选清单
- 按编码分组汇总工程量和造价
- 按总造价降序排列

### full-cost（全费用计算）
- 从 C.4 汇总表提取四大费用（分部分项/措施/其他/增值税）
- 计算措施费分摊率和综合税率
- 按单位工程计算全费用（工程费 + 措施费分摊 + 税金）
- 显示 C.15 增值税明细

### diff（修改前后对比）
- 加载两个文件，以项目编码为主键 JOIN
- 对比：新增项、删除项、单价变动、工程量变动
- 按合价差异金额排序显示
- 输出总造价差异和变动百分比

## 限制

- 仅支持 SELECT 查询，禁止修改操作
- 文件大小建议不超过 100MB，数据行不超过 5 万行
- 不保留 Excel 公式、宏、图表等特性
- C.6 Sheet 的单位工程归属依赖 C.5 汇总表的层级结构，个别特殊情况可能需要人工确认
