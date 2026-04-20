# QQ Bot 集成指南

通过 cc-connect 桥接 Claude Code 和 QQ 机器人，实现语音、文字、图片、文件方式的成本数据入库和查询。

## 前置条件

| 组件 | 要求 | 安装 |
|------|------|------|
| cc-connect | v1.2.2+ | [GitHub Release](https://github.com/Asteroid-B-612-ZS/cc-connect/releases) |
| QQ 机器人 | 已审核通过 | [QQ 开放平台](https://q.qq.com/) |
| ffmpeg | 语音功能必须 | `winget install ffmpeg` |
| Python | 3.12+ | 已有 |
| cost-engineering-skill | 已安装 | `install.ps1` |

## 架构

```
QQ 用户（语音/文字/图片/文件）
      │
      ▼
  QQ 官方机器人（WebSocket）
      │
      ▼
  cc-connect（消息桥接 + 语音转文字）
      │
      ├─ 语音 → ffmpeg + STT(Groq/OpenAI/Qwen) → 文字
      ├─ 图片 → Claude Code 多模态识别
      ├─ 文件 → 读取内容
      └─ 文字 → 直接传递
      │
      ▼
  Claude Code + cost-entry SKILL
      │
      ├─ cost_db.py（SQLite 操作）
      └─ api_server.py（HTTP API）
```

## 快速开始

### 1. 下载 cc-connect

```powershell
# 下载最新版 cc-connect
# 从 https://github.com/Asteroid-B-612-ZS/cc-connect/releases 下载 Windows 版本
# 放到任意目录，如 D:\AI\cc-connect\
```

### 2. 配置

```powershell
# 复制配置模板
copy engine\cc-connect-config.toml %USERPROFILE%\.cc-connect\config.toml

# 编辑配置，填入实际值：
# - app_id / token：QQ 开放平台获取
# - work_dir：cost-engineering engine 目录路径
# - speech.groq.api_key：Groq API 密钥（https://console.groq.com/）
# - admin_from：你的 QQ 号（可选）
# - 刷新命令的 exec 路径
```

### 3. 安装 ffmpeg（语音功能）

```powershell
winget install ffmpeg
# 安装后重启终端，验证：
ffmpeg -version
```

### 4. 启动

```powershell
# 启动 API 服务（可选，用于 HTTP 入库）
cd engine
python api_server.py

# 另一个终端启动 cc-connect
D:\AI\cc-connect\cc-connect.exe
```

### 5. 在 QQ 中使用

将 QQ 机器人添加到频道或群聊，然后：

| 操作 | 示例 | 说明 |
|------|------|------|
| 文字入库 | `/入库 钢筋 5500t 华东 信息价` | 直接发送文字 |
| 语音入库 | 🎤 "钢筋五千五一吨，华东信息价" | 发送语音消息 |
| 图片识别 | 📷 [报价单截图] + `/识别` | 发送图片后触发 |
| 查询价格 | `查成本 钢筋` 或 `查询 钢筋` | 使用别名触发 |
| 生成看板 | `看板` | 简单触发词 |
| 单位换算 | `/换算 1 钢筋(吨→㎡,50kg/m²)` | 指定公式 |
| 刷新数据 | `刷新` | 执行 shell 命令刷新 |

## 输入方式详解

### 文字

最直接的方式，支持自然语言和结构化格式：

```
/入库 钢筋 HRB400 5500t 华东地区 2026-04-19 信息价
/入库 模板人工 45m² 上海项目 张三报价
查成本 混凝土 C30
```

### 语音

语音消息会自动转为文字，再按文字流程处理。STT 提供商选择：

| 提供商 | 模型 | 优点 | 缺点 |
|--------|------|------|------|
| **Groq**（推荐） | whisper-large-v3-turbo | 免费、快速、中文好 | 需注册 Groq |
| OpenAI | whisper-1 | 稳定 | 付费 |
| Qwen | sensevoice-v1 | 中文优化 | 需阿里云账号 |

语音识别建议：
- 说清楚数字："五千五" → 5500
- 包含单位："每吨"、"每平方"
- 说明地区和来源

### 图片

发送报价单、截图等图片后使用 `/识别` 命令：

1. 发送图片到对话
2. 发送 `/识别`
3. Claude Code 自动 OCR 识别图片内容
4. 提取成本数据 → 标准化 → 校验 → 入库

支持的图片类型：报价单截图、价目表照片、信息价文件截图

### 文件

直接发送文件（如 Excel、PDF），cc-connect 会读取内容传递给 Claude Code 处理。

## 自定义命令参考

配置文件中定义了以下命令：

| 命令 | 触发方式 | 功能 |
|------|----------|------|
| `/入库` | `/入库 ...` 或别名 `入库` | 录入成本数据（写入待审核 Excel） |
| `/查成本` | `/查成本 ...` 或别名 `查询`/`查` | 搜索历史价格 |
| `/看板` | `/看板` 或别名 `看板` | 生成价格看板 |
| `/换算` | `/换算` | 执行单位换算 |
| `/识别` | `/识别` 或别名 `识别` | OCR 识别图片（写入待审核 Excel） |
| `/刷新` | `/刷新` 或别名 `刷新` | 刷新看板（shell 执行） |

## 审核入库流程

QQ Bot 录入的数据不会直接进入数据库，而是先写入 Excel 审核文件：

1. 通过 `/入库` 或 `/识别` 命令录入 → 数据写入 `待审核_YYYY-MM-DD.xlsx`
2. 用户打开 Excel 文件，检查数据，将"审核状态"列改为"已审核"或"已拒绝"
3. 运行 `python cost_db.py commit` 将已审核的数据导入 SQLite

```bash
# 列出待审核文件
python cost_db.py pending-list

# 提交最新待审核文件
python cost_db.py commit

# 提交所有待审核文件
python cost_db.py commit --all
```

### 添加自定义命令

在 `config.toml` 中添加：

```toml
[[commands]]
name = "你的命令名"
description = "命令描述"
prompt = """处理指令，{{args}} 代表用户输入的参数"""
```

或使用 shell 执行：

```toml
[[commands]]
name = "刷新"
description = "刷新看板"
exec = "cd '你的数据库路径' && python cost_db.py dashboard"
```

### 添加别名

```toml
[[aliases]]
name = "中文触发词"
command = "/对应命令"
```

## Agent 模式说明

| 模式 | 说明 | 适用场景 |
|------|------|----------|
| `default` | 每次操作需确认 | 初期调试 |
| `auto` | 自动执行 | **推荐**，日常使用 |
| `acceptEdits` | 自动接受文件编辑 | 批量操作 |
| `bypassPermissions` | 跳过所有确认 | 谨慎使用 |

推荐使用 `auto` 模式配合 `allowed_tools` 限制工具范围，兼顾便利和安全。

## 故障排除

| 问题 | 原因 | 解决 |
|------|------|------|
| 语音无法识别 | ffmpeg 未安装 | `winget install ffmpeg` 并重启终端 |
| 命令无响应 | cc-connect 未启动 | 检查进程是否运行 |
| 图片识别失败 | 图片过大或格式不支持 | 压缩图片或转换格式 |
| 数据库找不到 | work_dir 路径错误 | 检查 config.toml 中的 work_dir |
| 权限不足 | admin_from 未设置 | 在 config.toml 中设置你的 QQ 号 |
| QQ 机器人不在线 | WebSocket 断开 | 检查网络，重启 cc-connect |
