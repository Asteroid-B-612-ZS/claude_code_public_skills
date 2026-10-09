#!/usr/bin/env python3
"""Validate new PR title and non-merge commit subjects (QiZhi Git pilot)."""
from __future__ import annotations

import argparse
import re
import subprocess
import sys

TYPES = (
    "feat", "fix", "docs", "refactor", "test", "chore",
    "ci", "build", "perf", "revert", "release",
)
SUBJECT_RE = re.compile(
    rf"(?P<type>{'|'.join(TYPES)})"
    r"\((?P<scope>[a-z0-9]+(?:-[a-z0-9]+)*)\)"
    r"(?P<breaking>!)?: "
    r"(?P<summary>\S(?:[^\r\n]*\S)?)"
)
# Validate user-supplied revision range before passing it as a git argument.
RANGE_RE = re.compile(r"[0-9a-fA-F]{7,64}\.\.[0-9a-fA-F]{7,64}")


def validate_subject(subject: str, *, source: str = "commit") -> list[str]:
    """Return stable, actionable errors; merge commits excluded by git log."""
    code = "QZ-GIT-001" if source == "pr" else "QZ-GIT-002"
    if not SUBJECT_RE.fullmatch(subject):
        return [f"{code}: invalid {source} title: {subject!r}"]
    if len(subject) > 120:
        return [f"{code}: {source} title exceeds 120 characters"]
    return []


def non_merge_subjects(revision_range: str) -> list[str]:
    if not RANGE_RE.fullmatch(revision_range):
        raise ValueError("QZ-GIT-003: invalid base..head SHA range")
    completed = subprocess.run(
        ["git", "log", "--no-merges", "--format=%s", revision_range],
        check=True, capture_output=True, text=True, encoding="utf-8",
    )
    return [line for line in completed.stdout.splitlines() if line]


def validate_pr(pr_title: str, commit_subjects: list[str]) -> list[str]:
    errors = validate_subject(pr_title, source="pr")
    if not commit_subjects:
        errors.append("QZ-GIT-004: no non-merge commits in PR range")
    for subject in commit_subjects:
        errors.extend(validate_subject(subject))
    return errors


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pr-title", required=True)
    parser.add_argument("--commit-range", required=True,
                        help="Full SHA range BASE_SHA..HEAD_SHA")
    args = parser.parse_args(argv)
    try:
        errors = validate_pr(args.pr_title, non_merge_subjects(args.commit_range))
    except (ValueError, subprocess.CalledProcessError, OSError) as exc:
        print(f"QZ-GIT-003: cannot inspect PR commit range: {exc}", file=sys.stderr)
        return 1
    if errors:
        print("QiZhi Git workflow: BLOCKED", file=sys.stderr)
        for error in errors:
            print(error, file=sys.stderr)
        return 1
    print("QiZhi Git workflow: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
