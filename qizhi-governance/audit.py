#!/usr/bin/env python3
"""Deterministic per-repository QiZhi Git governance adoption audit."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import re
import sys

STANDARDS_VERSION = "1.3.0"
STANDARDS_COMMIT = "a07f432d5cf645a281f54ff35a219b85f0234667"
WORKFLOW = ".github/workflows/qizhi-governance.yml"
LOCK = ".qizhi/governance.lock.json"
DOCUMENT = ".qizhi/GIT_GOVERNANCE.md"
PUBLIC_REUSABLE = "Asteroid-B-612-ZS/claude_code_public_skills/.github/workflows/qizhi-reusable.yml"


def audit(root: Path) -> list[str]:
    issues: list[str] = []
    target = root / LOCK
    if not target.is_file():
        return ["QZ-ADOPT-001: missing .qizhi/governance.lock.json"]
    try:
        manifest = json.loads(target.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        return [f"QZ-ADOPT-002: cannot parse lock file: {error}"]
    for key, expected in (
        ("schema_version", 1),
        ("standards_version", STANDARDS_VERSION),
        ("standards_tag", "v1.3.0"),
        ("standards_commit", STANDARDS_COMMIT),
        ("executor_repository", "Asteroid-B-612-ZS/claude_code_public_skills"),
    ):
        if manifest.get(key) != expected:
            issues.append(f"QZ-ADOPT-003: {key} differs from pinned standard")
    sha = manifest.get("executor_commit")
    if not isinstance(sha, str) or not re.fullmatch(r"[0-9a-f]{40}", sha):
        issues.append("QZ-ADOPT-004: executor_commit must be a full lower-case SHA")
    legacy = manifest.get("legacy_pr_numbers", [])
    if not isinstance(legacy, list) or not all(type(x) is int and x > 0 for x in legacy):
        issues.append("QZ-ADOPT-005: legacy PR exceptions must be positive integer IDs")
    for path in (WORKFLOW, DOCUMENT, "AGENTS.md", "CLAUDE.md"):
        if not (root / path).is_file():
            issues.append(f"QZ-ADOPT-006: missing {path}")
    workflow = root / WORKFLOW
    if workflow.is_file() and isinstance(sha, str):
        body = workflow.read_text(encoding="utf-8")
        if f"{PUBLIC_REUSABLE}@{sha}" not in body:
            issues.append("QZ-ADOPT-007: reusable workflow does not pin executor SHA")
        for trigger in ("pull_request:", "schedule:"):
            if trigger not in body:
                issues.append(f"QZ-ADOPT-008: missing workflow trigger: {trigger}")
    if (root / DOCUMENT).is_file():
        policy = (root / DOCUMENT).read_text(encoding="utf-8")
        if STANDARDS_COMMIT not in policy or "v1.3.0" not in policy:
            issues.append("QZ-ADOPT-009: governance guide lacks immutable Standards reference")
    for path in ("AGENTS.md", "CLAUDE.md"):
        if (root / path).is_file() and DOCUMENT not in (root / path).read_text(encoding="utf-8"):
            issues.append(f"QZ-ADOPT-010: {path} must point to {DOCUMENT}")
    return issues


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", type=Path, default=Path("."))
    args = parser.parse_args()
    issues = audit(args.repo_root)
    if issues:
        for issue in issues:
            print(issue, file=sys.stderr)
        print("QiZhi repository adoption: BLOCKED", file=sys.stderr)
        return 1
    print(f"QiZhi repository adoption: PASS (Standards v{STANDARDS_VERSION}; Git-only)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
