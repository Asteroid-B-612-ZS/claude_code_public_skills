# cost-engineering-skill 安装脚本
# 用法：powershell -File install.ps1

$ErrorActionPreference = "Stop"

$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
$SKILL_SRC = Join-Path $SCRIPT_DIR "skill.md"
$ENGINE_DIR = Join-Path $SCRIPT_DIR "engine"
$CLAUDE_SKILLS_DIR = "$env:USERPROFILE\.claude\skills"
$SKILL_DEST = Join-Path $CLAUDE_SKILLS_DIR "cost-entry.md"

Write-Host "=== cost-engineering-skill 安装 ===" -ForegroundColor Cyan

# 1. 创建 skills 目录
if (-not (Test-Path $CLAUDE_SKILLS_DIR)) {
    New-Item -ItemType Directory -Path $CLAUDE_SKILLS_DIR -Force | Out-Null
    Write-Host "[OK] 创建 skills 目录：$CLAUDE_SKILLS_DIR" -ForegroundColor Green
}

# 2. 复制 SKILL 文件
Copy-Item $SKILL_SRC $SKILL_DEST -Force
Write-Host "[OK] SKILL 已安装：$SKILL_DEST" -ForegroundColor Green

# 3. 检查 Python
$pythonCmd = $null
foreach ($cmd in @("python", "python3")) {
    try {
        $version = & $cmd --version 2>&1
        if ($LASTEXITCODE -eq 0) {
            $pythonCmd = $cmd
            Write-Host "[OK] Python：$version" -ForegroundColor Green
            break
        }
    } catch {}
}

if (-not $pythonCmd) {
    Write-Host "[WARN] 未找到 Python，跳过数据库初始化" -ForegroundColor Yellow
    Write-Host "       安装 Python 后手动运行：python engine\init_db.py" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "=== 安装完成（SKILL only）===" -ForegroundColor Cyan
    exit 0
}

# 4. 初始化数据库
$dbDir = Join-Path $ENGINE_DIR ""
$dbPath = Join-Path $ENGINE_DIR "成本数据.db"

if (Test-Path $dbPath) {
    Write-Host "[INFO] 数据库已存在，跳过初始化：$dbPath" -ForegroundColor Yellow
} else {
    Push-Location $ENGINE_DIR
    & $pythonCmd init_db.py
    Pop-Location
    Write-Host "[OK] 数据库已初始化：$dbPath" -ForegroundColor Green
}

# 5. 安装 Python 依赖
$hasDeps = & $pythonCmd -c "import openpyxl; print('ok')" 2>&1
if ($hasDeps -ne "ok") {
    Write-Host "[INFO] 安装 Python 依赖（openpyxl, fastapi, uvicorn）..." -ForegroundColor Yellow
    & $pythonCmd -m pip install -r (Join-Path $ENGINE_DIR "requirements.txt") --quiet
    Write-Host "[OK] 依赖安装完成" -ForegroundColor Green
} else {
    Write-Host "[OK] Python 依赖已就绪" -ForegroundColor Green
}

Write-Host ""
Write-Host "=== 安装完成（V3.3）===" -ForegroundColor Cyan
Write-Host ""
Write-Host "使用方法：" -ForegroundColor White
Write-Host "  入库（QQ Bot）：发送 /入库 钢筋 5500元/t → 写入待审核 Excel"
Write-Host "  审核入库：在 Excel 中标记已审核 → python cost_db.py commit"
Write-Host "  查询/换算/看板：查成本 / 换算 / 看板"
Write-Host ""
Write-Host "数据库路径：$dbPath"
Write-Host "SKILL 路径：$SKILL_DEST"
