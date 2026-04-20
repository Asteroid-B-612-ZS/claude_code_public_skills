# cost-engineering-skill

工程造价成本数据管理的 Claude Code SKILL。自包含，无外部文件依赖。将工程造价领域知识（数据字典、校验规则、换算公式、单位标准）内置于 SQLite 数据库，配合 Python CLI 实现成本数据的智能录入、自动校验与分析。

## 系统架构

```
skill.md（领域知识 + 工作流程）
    │
    ├── 数据字典（40 项成本项：人工费18 / 材料费11 / 机械费10 / 综合1）
    ├── 校验规则（价格区间 + 重复检测 + 趋势监控，引擎自动执行）
    ├── 换算公式（12 条，存储在数据库 conversion_formula 表）
    └── 单位标准（42 条标准单位 + 别名映射）
          │
          ▼
engine/cost_db.py（SQLite 数据库 CLI）
    │
    ├── 8 表关系型结构（含 validation_rule、conversion_formula）
    ├── pending / commit（待审核 Excel → 审核入库，两阶段流程）
    ├── insert / update / delete / query / dashboard
    ├── convert / convert-tax（单位/税额换算）
    ├── 自动校验（价格区间 / 重复检测 / 趋势监控）
    └── 自动导出 JSON（移动端查询用）
          │
          ▼
engine/api_server.py（HTTP API，已废弃，保留向后兼容）
```

### 入库流程（两阶段审核）

```
QQ Bot / 手动输入
      ↓
  python cost_db.py pending → 写入待审核 Excel（自动校验结果标注在 Excel 中）
      ↓
  用户在 Excel 中标记"已审核"或"已拒绝"
      ↓
  python cost_db.py commit → 仅已审核数据导入 SQLite
```

## 安装

### 前置条件

- Python 3.12+
- Claude Code CLI

### 一键安装

```powershell
git clone https://github.com/Asteroid-B-612-ZS/claude_code_public_skills.git
cd claude_code_public_skills/cost-engineering
powershell -File install.ps1
```

安装脚本会：
1. 复制 `skill.md` → `~/.claude/skills/cost-entry.md`
2. 初始化 SQLite 数据库（8 张表 + 预置标准数据）
3. 安装 Python 依赖（fastapi、uvicorn、openpyxl）

### 手动安装

```powershell
# 复制 SKILL
copy skill.md %USERPROFILE%\.claude\skills\cost-entry.md

# 初始化数据库
cd engine
python init_db.py --db "你的路径/成本数据.db"

# 安装依赖（仅 HTTP API 需要）
pip install -r requirements.txt
```

### 环境变量

| 变量 | 用途 | 默认值 |
|------|------|--------|
| `COST_DB_PATH` | 数据库文件路径 | cost_db.py 同目录 |
| `COST_API_KEY` | API 认证密钥（不设置则无认证） | 无 |
| `COST_PROJECT_DIR` | 项目报表输出目录 | 无（输出到终端） |
| `CORS_ORIGINS` | API 允许的跨域来源（逗号分隔） | * |

## 使用

在 Claude Code 对话中使用：

| 功能 | 方式 | 示例 |
|------|------|------|
| 录入（待审核） | 描述数据 | `入库 钢筋 5500 t 上海 信息价` |
| 审核入库 | commit 命令 | `python cost_db.py commit` |
| 查询 | 搜索关键词 | `查成本 钢筋` |
| 换算 | 指定公式 | `换算 1 钢筋(吨→㎡,50kg/m²)` |
| 看板 | 生成报告 | `看板` |
| 识别 | OCR 图片 | `识别`（识别后写入待审核 Excel） |
| 待审核列表 | pending-list | `python cost_db.py pending-list` |

## 数据库结构

8 表关系型 SQLite：

```
cost_item（成本项定义）─── 1:N ──→ cost_price（价格样本）
                                       ├── 1:N ──→ cost_component（工料机拆分）
                                       └── 1:N ──→ cost_feature（价格特征）

unit_standard（单位标准 + 别名映射，42 条）
tax_rate（税率预设，5 条）
validation_rule（价格校验区间，47 条）── 自动校验
conversion_formula（单位换算公式，12 条）── 自包含
```

| 表 | 作用 | 预置数据 |
|----|------|----------|
| cost_item | 标准成本项 | 14 项（随入库自动创建） |
| cost_price | 价格样本 | 空（用户数据） |
| cost_component | 工料机拆分 | 空（预留） |
| cost_feature | 价格影响条件 | 空（预留） |
| unit_standard | 单位别名映射 | 42 条 |
| tax_rate | 税率预设 | 5 条 |
| validation_rule | 价格校验区间 | 47 条 |
| conversion_formula | 单位换算公式 | 12 条 |

### cost_price 字段

| 字段 | 说明 |
|------|------|
| item_id | 关联 cost_item（自动匹配或创建） |
| price | 单价 |
| unit | 标准单位（自动归一化） |
| date | YYYY-MM-DD |
| tax_method | 含税 / 税前 / 不详 |
| price_type | 信息价 / 电话询价 / 微信询价 / 现场询价 / 合同价 / 询价单 / 定额 |
| source | 数据来源标识 |
| source_person | 报价人 |
| location | 城市名 |
| project_name | 项目名称 |
| spec | 规格 |
| status | 已确认 / 待核实 |
| input_device | iPhone / PC / iPad |
| source_file | 原始文件名 |
| raw_text | 原始输入文本 |
| is_composite | 是否综合报价 |
| conversion_source | 换算来源ID |
| conversion_formula | 换算公式 |
| remark | 备注（校验警告自动追加） |

### 自动校验

入库时引擎自动执行以下校验：
- **价格区间**：对比 validation_rule 表，超限标记"待核实"
- **重复检测**：同日+同项+同价+同人 → 警告
- **趋势监控**：最近 3 次持续上涨 >20% → 标记"待核实"
- **工料机拆分**：三项之和与单价偏差 >5% → 标记"待核实"
- **未知名称**：不在校验规则中 → 备注追加"待补充词条"

## CLI 命令

```bash
cd engine

# ── 入库（推荐：两阶段审核） ──

# 写入待审核 Excel（QQ Bot 入库推荐）
python cost_db.py pending --日期 2026-04-19 --大类 人工费 --名称 钢筋 --单价 5500 --单位 t

# 列出待审核文件
python cost_db.py pending-list

# 审核后导入 SQLite（用户在 Excel 中标记"已审核"后执行）
python cost_db.py commit                    # 提交最新待审核文件
python cost_db.py commit --all              # 提交所有待审核文件
python cost_db.py commit --file PATH        # 提交指定文件

# ── 直接入库（手动/调试用） ──

python cost_db.py insert --日期 2026-04-19 --大类 人工费 --名称 钢筋 --单价 5500 --单位 t

# 查询
python cost_db.py query "SELECT p.*, i.name, i.category FROM cost_price p JOIN cost_item i ON p.item_id = i.id"

# 更新
python cost_db.py update 1 状态 已确认

# 删除
python cost_db.py delete 1

# 看板
python cost_db.py dashboard

# 项目报表
python cost_db.py project "示例住宅项目"

# 单位换算
python cost_db.py convert 1 --formula "钢筋(吨→㎡,50kg/m²)"

# 含税换算
python cost_db.py convert-tax 1 --rate 9

# 成本项管理
python cost_db.py items list

# 单位管理
python cost_db.py units list
```

## QQ Bot 集成（cc-connect）

通过 cc-connect 桥接 QQ 机器人，支持语音、文字、图片、文件方式的成本数据录入和查询。

### 快速配置

```powershell
# 1. 复制配置模板
copy engine\cc-connect-config.toml %USERPROFILE%\.cc-connect\config.toml

# 2. 编辑配置（填入 AppID、Token、API Key 等）

# 3. 安装 ffmpeg（语音功能需要）
winget install ffmpeg

# 4. 启动 cc-connect
cc-connect.exe
```

详细配置说明见 [docs/qq-integration.md](docs/qq-integration.md)。

## HTTP API（已废弃）

> `/import` 和 `/import/raw` 端点已废弃，建议改用 QQ Bot + pending/commit 两阶段流程。

```bash
# 启动服务（保留向后兼容）
cd engine
python api_server.py    # 监听 0.0.0.0:5000

# 可选：启用 API Key 认证
COST_API_KEY=your_secret python api_server.py
```

| 端点 | 方法 | 用途 | 认证 |
|------|------|------|------|
| `/import` | POST | [已废弃] 接收 JSON 自动入库 | 如配置了 API Key |
| `/import/raw` | POST | [已废弃] 接收 GLM 原始文本 | 如配置了 API Key |
| `/query?q=` | GET | 关键词搜索价格 | 如配置了 API Key |
| `/confirm` | POST | 确认待核实记录 | 如配置了 API Key |
| `/stats` | GET | 数据库统计 | 如配置了 API Key |
| `/health` | GET | 健康检查 | 无需认证 |

## 目录结构

```
cost-engineering/
├── skill.md                 # SKILL 主文件（自包含领域知识 + 工作流）
├── install.ps1              # Windows 一键安装脚本
├── README.md                # 本文件
├── .gitignore               # 排除 .db / __pycache__ 等
├── docs/
│   └── qq-integration.md    # QQ Bot 集成详细指南
└── engine/
    ├── cost_db.py           # 数据库 CLI 工具（含自动校验引擎）
    ├── api_server.py        # FastAPI HTTP 服务（含可选认证）
    ├── init_db.py           # 数据库初始化脚本（8 张表）
    ├── seed_data.json       # 预置数据（单位 + 税率 + 校验规则 + 换算公式）
    ├── cc-connect-config.toml  # cc-connect QQ Bot 配置模板
    └── requirements.txt     # fastapi, uvicorn
```

## 版本历史

| 版本 | 日期 | 内容 |
|------|------|------|
| V3.3 | 2026-04-20 | 两阶段审核入库：pending 写入 Excel → 用户审核 → commit 导入 SQLite；废弃 iPhone 快捷指令直接入库；新增 openpyxl 依赖 |
| V3.2 | 2026-04-19 | 自动校验引擎 + 安全加固 + 自包含（换算公式入库） |
| V3.1 | 2026-04-18 | Python 迁移 + HTTP API + 关系型 SQLite |
| V3.0 | 2026-04-18 | JSON 数据桥接，PC + iPhone 双端查询 |
| V2.x | 2026-04-15 | Node.js + sql.js WASM，SQLite 关系型结构 |
| V1.0 | 2026-04-12 | CSV 扁平存储 |

## 依赖

- **Python** 3.12+（数据库操作）
- **fastapi** + **uvicorn**（仅 HTTP API，已废弃）
- **openpyxl** >= 3.1.0（待审核 Excel 读写）
- **SQLite**（Python 内置，无需额外安装）
- **Claude Code CLI**（SKILL 加载）
