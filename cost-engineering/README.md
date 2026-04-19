# cost-engineering-skill

工程造价成本数据管理的 Claude Code SKILL。将工程造价领域知识（数据字典、校验规则、换算公式、单位标准）打包为可复用的技能文件，配合 SQLite 数据库引擎实现成本数据的智能录入、校验与分析。

## 系统架构

```
skill.md（领域知识 + 工作流程）
    │
    ├── 数据字典（40 项成本项：人工费18 / 材料费11 / 机械费10 / 综合1）
    ├── 校验规则（价格区间 + 三价对比 + 趋势监控）
    ├── 换算公式（13 条材料单位换算）
    └── 单位标准（82 条标准单位 + 别名映射）
          │
          ▼
engine/cost_db.py（SQLite 数据库 CLI）
          │
          ├── 6 表关系型结构
          ├── insert / update / delete / query / dashboard
          ├── convert / convert-tax（单位/税额换算）
          └── 自动导出 JSON（移动端查询用）
                │
                ▼
engine/api_server.py（HTTP API，移动端实时入库）
```

## 安装

### 前置条件

- Python 3.12+
- Claude Code CLI

### 一键安装

```powershell
git clone https://github.com/Asteroid-B-612-ZS/cost-engineering-skill.git
cd cost-engineering-skill
powershell -File install.ps1
```

安装脚本会：
1. 复制 `skill.md` → `~/.claude/skills/cost-entry.md`
2. 初始化 SQLite 数据库（空表 + 预置标准数据）
3. 安装 Python 依赖（fastapi、uvicorn）

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

## 使用

在 Claude Code 对话中使用触发词：

| 触发词 | 功能 | 示例 |
|--------|------|------|
| `入库` | 录入一条成本数据 | `入库 钢筋 5500 元/t 上海 信息价` |
| `整理` | 批量处理收件箱文件 | `整理` |
| `查成本` | 搜索历史价格 | `查成本 钢筋` |
| `换算` | 执行单位换算 | `换算 1 钢筋(吨→㎡,50kg/m²)` |
| `看板` | 生成价格看板 | `看板` |
| `识别` | OCR 识别图片报价 | `识别` |

## 数据库结构

6 表关系型 SQLite：

```
cost_item（成本项定义）─── 1:N ──→ cost_price（价格样本）
                                       ├── 1:N ──→ cost_component（工料机拆分）
                                       └── 1:N ──→ cost_feature（价格特征）

unit_standard（单位标准 + 别名映射，82 条）
tax_rate（税率预设，5 条）
```

| 表 | 作用 | 预置数据 |
|----|------|----------|
| cost_item | 标准成本项 | 16 项（随入库自动创建） |
| cost_price | 价格样本 | 空（用户数据） |
| cost_component | 工料机拆分 | 空（预留） |
| cost_feature | 价格影响条件 | 空（预留） |
| unit_standard | 单位别名映射 | 82 条 |
| tax_rate | 税率预设 | 5 条 |

## CLI 命令

```bash
cd engine

# 入库
python cost_db.py insert --日期 2026-04-19 --大类 人工费 --名称 钢筋 --单价 5500 --单位 元/t

# 查询
python cost_db.py query "SELECT p.*, i.name, i.category FROM cost_price p JOIN cost_item i ON p.item_id = i.id"

# 更新
python cost_db.py update 1 状态 已确认

# 删除
python cost_db.py delete 1

# 看板（生成 Markdown 报告 + 导出 JSON）
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

### QQ 端使用

| 操作 | 示例 | 说明 |
|------|------|------|
| 文字入库 | `/入库 钢筋 5500元/t` | 自然语言或结构化 |
| 语音入库 | 🎤 "钢筋五千五一吨" | 自动语音转文字 |
| 图片识别 | 📷 报价单 + `/识别` | OCR 提取成本数据 |
| 查询价格 | `查成本 钢筋` | 别名直接触发 |
| 生成看板 | `看板` | 一键生成 |

详细配置说明见 [docs/qq-integration.md](docs/qq-integration.md)。

---

## HTTP API（移动端入口）

```bash
# 启动服务
cd engine
python api_server.py    # 监听 0.0.0.0:5000
```

| 端点 | 方法 | 用途 |
|------|------|------|
| `/import` | POST | 接收 JSON 自动入库 |
| `/import/raw` | POST | 接收 GLM 原始文本入库 |
| `/query?q=` | GET | 关键词搜索价格 |
| `/confirm` | POST | 确认待核实记录 |
| `/stats` | GET | 数据库统计 |
| `/health` | GET | 健康检查 |

## 目录结构

```
cost-engineering-skill/
├── skill.md                 # SKILL 主文件（自包含领域知识 + 工作流）
├── install.ps1              # Windows 一键安装脚本
├── README.md                # 本文件
├── .gitignore               # 排除 .db / __pycache__ 等
├── docs/
│   └── qq-integration.md    # QQ Bot 集成详细指南
└── engine/
    ├── cost_db.py           # 数据库 CLI 工具（1046 行）
    ├── api_server.py        # FastAPI HTTP 服务（166 行）
    ├── cc-connect-config.toml  # cc-connect QQ Bot 配置模板
    ├── init_db.py           # 数据库初始化脚本
    ├── seed_data.json       # 预置数据（单位 82 条 + 税率 5 条 + 成本项 16 项）
    └── requirements.txt     # fastapi, uvicorn
```

## 版本历史

| 版本 | 日期 | 内容 |
|------|------|------|
| V3.1 | 2026-04-18 | Python 迁移 + HTTP API + 关系型 SQLite |
| V3.0 | 2026-04-18 | JSON 数据桥接，PC + iPhone 双端查询 |
| V2.x | 2026-04-15 | Node.js + sql.js WASM，SQLite 关系型结构 |
| V1.0 | 2026-04-12 | CSV 扁平存储 |

## 依赖

- **Python** 3.12+（数据库操作）
- **fastapi** + **uvicorn**（仅 HTTP API）
- **SQLite**（Python 内置，无需额外安装）
- **Claude Code CLI**（SKILL 加载）
