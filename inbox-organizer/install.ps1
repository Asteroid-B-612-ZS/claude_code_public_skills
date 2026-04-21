# inbox-organizer Skill 安装脚本
# V2.0 | 2026-04-21

$ErrorActionPreference = "Stop"
$SkillName = "inbox-organizer"
$SkillDir = "$env:USERPROFILE\.claude\skills\$SkillName"
$TopLevelSkill = "$env:USERPROFILE\.claude\skills\$SkillName.md"
$VaultRoot = "D:\iCloudDrive\iCloud~md~obsidian\QiZhi库"

Write-Host "=== inbox-organizer Skill 安装 ===" -ForegroundColor Cyan
Write-Host ""

# 1. 验证 skill 目录存在
if (-not (Test-Path $SkillDir)) {
    Write-Host "[ERROR] Skill 目录不存在: $SkillDir" -ForegroundColor Red
    exit 1
}
Write-Host "[OK] Skill 目录: $SkillDir" -ForegroundColor Green

# 2. 验证 SKILL.md 存在
$skillMd = Join-Path $SkillDir "SKILL.md"
if (-not (Test-Path $skillMd)) {
    Write-Host "[ERROR] SKILL.md 不存在: $skillMd" -ForegroundColor Red
    exit 1
}
Write-Host "[OK] SKILL.md 已就绪" -ForegroundColor Green

# 3. 复制 SKILL.md 到顶层注册（Claude Code 加载入口）
Copy-Item $skillMd $TopLevelSkill -Force
Write-Host "[OK] 顶层注册: $TopLevelSkill" -ForegroundColor Green

# 4. 验证 Obsidian 目录结构
$requiredDirs = @(
    "$VaultRoot\00_收件箱",
    "$VaultRoot\10_每日日志",
    "$VaultRoot\20_工程项目",
    "$VaultRoot\40_资源模板",
    "$VaultRoot\50_收件箱备份",
    "$VaultRoot\50_系统"
)

$allOk = $true
foreach ($dir in $requiredDirs) {
    if (Test-Path $dir) {
        Write-Host "[OK] $dir" -ForegroundColor Green
    } else {
        Write-Host "[WARN] 目录不存在: $dir" -ForegroundColor Yellow
        $allOk = $false
    }
}

# 5. 验证日志模板
$templatePath = "$VaultRoot\40_资源模板\日志模板.md"
if (Test-Path $templatePath) {
    Write-Host "[OK] 日志模板: $templatePath" -ForegroundColor Green
} else {
    Write-Host "[ERROR] 日志模板不存在: $templatePath" -ForegroundColor Red
    $allOk = $false
}

# 5.1 验证项目模板
$projectTemplatePath = "$VaultRoot\40_资源模板\项目模板.md"
if (Test-Path $projectTemplatePath) {
    Write-Host "[OK] 项目模板: $projectTemplatePath" -ForegroundColor Green
} else {
    Write-Host "[ERROR] 项目模板不存在: $projectTemplatePath" -ForegroundColor Red
    $allOk = $false
}

# 5.2 验证系统文件
$dashboardPath = "$VaultRoot\50_系统\_dashboard.md"
$logPath = "$VaultRoot\50_系统\_log.md"
if (Test-Path $dashboardPath) {
    Write-Host "[OK] 系统控制台: $dashboardPath" -ForegroundColor Green
} else {
    Write-Host "[ERROR] 系统控制台不存在: $dashboardPath" -ForegroundColor Red
    $allOk = $false
}
if (Test-Path $logPath) {
    Write-Host "[OK] 操作日志: $logPath" -ForegroundColor Green
} else {
    Write-Host "[WARN] 操作日志不存在: $logPath" -ForegroundColor Yellow
}

# 6. 验证 cost-engineering 依赖
$costEngine = "$env:USERPROFILE\.claude\skills\cost-engineering\engine\cost_db.py"
if (Test-Path $costEngine) {
    Write-Host "[OK] cost-engineering 引擎: $costEngine" -ForegroundColor Green
} else {
    Write-Host "[ERROR] cost-engineering 引擎不存在: $costEngine" -ForegroundColor Red
    $allOk = $false
}

# 7. 确保备份附件目录存在
$backupAttach = "$VaultRoot\50_收件箱备份\附件"
if (-not (Test-Path $backupAttach)) {
    New-Item -ItemType Directory -Path $backupAttach -Force | Out-Null
    Write-Host "[OK] 创建备份附件目录: $backupAttach" -ForegroundColor Green
}

Write-Host ""
if ($allOk) {
    Write-Host "=== 安装成功 ===" -ForegroundColor Cyan
    Write-Host "inbox-organizer V2.0 已就绪" -ForegroundColor White
    Write-Host "在 Claude Code 中说 '整理今天日志并更新系统' 即可触发" -ForegroundColor White
} else {
    Write-Host "=== 安装完成（有警告） ===" -ForegroundColor Yellow
    Write-Host "部分目录不存在，请检查 Obsidian vault 路径" -ForegroundColor White
}
