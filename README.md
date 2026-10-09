# claude_code_public_skills

Claude Code 公开技能集合。

## 技能列表

| 技能 | 目录 | 说明 |
|------|------|------|
| 工程造价成本数据管理 | [cost-engineering/](cost-engineering/) | 日志驱动 + AI 调度 + SQLite 数据沉淀 + 分析决策 |

## QiZhi Git 治理执行器（public，独立于 Skill 业务）

`qizhi-governance/` 是 Standards [v1.3.0](https://github.com/Asteroid-B-612-ZS/QiZhi_CostTools_Standards/releases/tag/v1.3.0) 的**只读、公开可复用的 Git 校验器副本**，不会公开私有业务资料或改变造价/汽车项目版本。原始 `validate_git_workflow.py` 与 `validate_branch_name.py` 逐字复制自正式 v1.3.0，其 Git Blob SHA 在审核中验证相同。

`bootstrap.py` 为任何本地新/旧项目生成 `.qizhi/governance.lock.json`、CI、AGENTS/CLAUDE 入口；`audit.py` 在 PR 和每周检查安装完整性。所有接入方使用 **完整 40 位 commit SHA** 固定调用公开复用工作流，绝不运行未固定版本的 main。复制执行器遵循标准库的治理，不改变任何业务模块的 `standards.baseline`。

注：GitHub 连接暂不支持创建新的仓库，因此这套公开执行器暂托管在已有公开仓库的隔离目录，未来可无损迁移至专用执行仓库；GitHub 平台级必需检查仍取决于分支保护权限与套餐。
