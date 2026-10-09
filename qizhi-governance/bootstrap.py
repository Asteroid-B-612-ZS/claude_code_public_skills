#!/usr/bin/env python3
"""Initialize Git-only governance without changing a project's business baseline."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import re
from audit import audit, DOCUMENT, STANDARDS_COMMIT, PUBLIC_REUSABLE

GOVERNANCE_TEXT = """# QiZhi Git governance — version-pinned

Git-only policy: Standards **v1.3.0** at commit **a07f432d5cf645a281f54ff35a219b85f0234667**.

1. Create development branches as \`<type>/<scope>-<topic>\`; retain existing default main/master.
2. New non-merge commits and PR titles: \`type(scope): description\`.
3. PR → CI → review → **Create a merge commit**; generated merge headline is exempt.
4. No direct feature development on production branches, no history or release-tag rewrites.
5. Failed governance or project-specific tests block merge until corrected; approval for material
   business or release changes remains with the user.
6. **This Git-only reference does not update a module's existing Standards Baseline,
   software version, templates, calibration data, engineering calculations, or releases.**
7. For pre-adoption in-flight PRs, recorded legacy PR number exceptions apply only to
   Git subject/branch checks; existing project CI checks remain mandatory.

Canonical source: https://github.com/Asteroid-B-612-ZS/QiZhi_CostTools_Standards/blob/v1.3.0/standards/GIT_WORKFLOW_GOVERNANCE_STANDARD.md
Pinned executor: see \`.qizhi/governance.lock.json\`.
"""

def adapter(name: str) -> str:
    return (
        "\n\n## QiZhi Git governance\n\n"
        f"For all Git branches, new commits, PRs and merges, read **{DOCUMENT}** before writing. "
        "This entrypoint references the pinned version of the common Git standard; "
        "keep pre-existing project-specific business and AI restrictions intact.\n"
    )


def install(root: Path, executor_sha: str, *, legacy: list[int],
            force: bool = False) -> list[str]:
    if not re.fullmatch(r"[0-9a-f]{40}", executor_sha):
        raise ValueError("Full 40-character lower-case executor commit SHA required")
    paths = {
        ".qizhi/governance.lock.json": json.dumps({
            "schema_version": 1,
            "standards_version": "1.3.0",
            "standards_tag": "v1.3.0",
            "standards_commit": STANDARDS_COMMIT,
            "executor_repository": "Asteroid-B-612-ZS/claude_code_public_skills",
            "executor_commit": executor_sha,
            "legacy_pr_numbers": sorted(set(legacy))
        }, ensure_ascii=False, indent=2) + "\n",
        DOCUMENT: GOVERNANCE_TEXT,
        ".github/workflows/qizhi-governance.yml": (
            "name: QiZhi Governance\n"
            "on:\n"
            "  pull_request:\n"
            "  push:\n"
            "  schedule:\n"
            "    - cron: '17 4 * * 1'\n"
            "permissions:\n"
            "  contents: read\n"
            "jobs:\n"
            "  governance:\n"
            f"    uses: {PUBLIC_REUSABLE}@{executor_sha}\n"
        )
    }
    changes: list[str] = []
    for relative, content in paths.items():
        target = root / relative
        if target.exists() and target.read_text(encoding="utf-8") != content and not force:
            raise FileExistsError(f"{relative} already exists and differs; use --force for an intentional upgrade")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        changes.append(relative)
    for name in ("AGENTS.md", "CLAUDE.md"):
        target = root / name
        existing = target.read_text(encoding="utf-8") if target.exists() else f"# {name}\n"
        if DOCUMENT not in existing:
            target.write_text(existing.rstrip() + adapter(name), encoding="utf-8")
            changes.append(name)
    problems = audit(root)
    if problems:
        raise RuntimeError("Generated governance failed validation: " + "; ".join(problems))
    return changes


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", type=Path, default=Path("."))
    parser.add_argument("--executor-sha", required=True)
    parser.add_argument("--legacy-pr", type=int, action="append", default=[])
    parser.add_argument("--force", action="store_true",
                        help="Explicitly overwrite existing governance policy on upgrade")
    args = parser.parse_args()
    try:
        changes = install(args.repo_root, args.executor_sha,
                          legacy=args.legacy_pr, force=args.force)
    except (ValueError, FileExistsError, RuntimeError) as error:
        parser.error(str(error))
    print("QiZhi governance initialized; files: " + ", ".join(changes))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
