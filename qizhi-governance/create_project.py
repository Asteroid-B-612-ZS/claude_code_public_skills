#!/usr/bin/env python3
"""Create a new project with pinned Git-only governance; remote creation is opt-in."""
from __future__ import annotations

import argparse
from pathlib import Path
import re
import subprocess
import sys

from bootstrap import install

EXECUTOR_SHA = "1b6ec2336d3e80a589d69879b9bd5b8c63488701"
PROJECT_KINDS = ("generic", "python", "android", "skill", "miniapp")
GITIGNORE = {
    "generic": ".DS_Store\n*.log\n.env\n",
    "python": ".venv/\n__pycache__/\n*.pyc\n.env\n",
    "android": ".gradle/\n/build/\n/local.properties\n*.apk\n",
    "skill": ".DS_Store\n__pycache__/\n.env\n",
    "miniapp": ".DS_Store\nnode_modules/\nproject.private.config.json\n.env\n",
}

def validate_slug(value: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,99}", value) or value.endswith("."):
        raise ValueError("Repository name must be a safe GitHub slug of 1-100 characters")
    return value

def commands_for(name: str, path: Path, *, owner: str | None,
                 visibility: str) -> list[list[str]]:
    if owner is not None and not re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?", owner):
        raise ValueError("Invalid GitHub owner login")
    full = f"{owner}/{name}" if owner else name
    return [
        ["git", "-C", str(path), "init", "-b", "main"],
        ["git", "-C", str(path), "add", "."],
        ["git", "-C", str(path), "commit", "-m", "chore(repo): initialize pinned Git governance"],
        ["gh", "repo", "create", full, "--"+visibility, "--source", str(path), "--remote", "origin", "--push"],
    ]

def create_project(name: str, root: Path, *, kind: str = "generic",
                   owner: str | None = None, visibility: str = "private",
                   remote: bool = False, dry_run: bool = False,
                   runner=subprocess.run) -> list[list[str]]:
    name = validate_slug(name)
    if kind not in PROJECT_KINDS:
        raise ValueError(f"Unsupported project type: {kind}")
    if visibility not in ("private", "public"):
        raise ValueError("Visibility must be private or public")
    path = root / name
    if path.exists() and any(path.iterdir()):
        raise FileExistsError(f"Refusing to overwrite nonempty directory: {path}")
    cmds = commands_for(name, path, owner=owner, visibility=visibility)
    if dry_run:
        return cmds[:3] + (cmds[3:] if remote else [])
    path.mkdir(parents=True, exist_ok=True)
    (path / "README.md").write_text(
        f"# {name}\n\nProject type: {kind}. Git-only governance is pinned; "
        "business behavior requires its own specification and tests.\n",
        encoding="utf-8",
    )
    (path / ".gitignore").write_text(GITIGNORE[kind], encoding="utf-8")
    install(path, EXECUTOR_SHA, legacy=[])
    # Execute through argument arrays, never through a shell.
    for args in cmds[:3]:
        runner(args, check=True)
    if remote:
        # Explicit opt-in; requires locally authenticated GitHub CLI.
        runner(cmds[3], check=True)
    return cmds[:3] + (cmds[3:] if remote else [])

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("name", help="GitHub-safe repository name")
    parser.add_argument("--root", type=Path, default=Path("."))
    parser.add_argument("--kind", choices=PROJECT_KINDS, default="generic")
    parser.add_argument("--owner", help="Optional GitHub owner/org login")
    parser.add_argument("--visibility", choices=("private", "public"), default="private")
    parser.add_argument("--create-remote", action="store_true",
                        help="Explicitly create GitHub repository with authenticated gh CLI")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    try:
        commands = create_project(
            args.name, args.root, kind=args.kind, owner=args.owner,
            visibility=args.visibility, remote=args.create_remote,
            dry_run=args.dry_run,
        )
    except (ValueError, FileExistsError, subprocess.CalledProcessError, OSError) as error:
        parser.error(str(error))
    for command in commands:
        print(" ".join(command))
    print("DRY RUN (no files changed)" if args.dry_run else "New project governance installed.")
    return 0

if __name__ == "__main__":
    sys.exit(main())
