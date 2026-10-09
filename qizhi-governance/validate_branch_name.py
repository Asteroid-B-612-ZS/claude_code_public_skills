from __future__ import annotations

import argparse
import re

NORMAL_TYPES = ("feature", "fix", "refactor", "docs", "test", "chore")
FORBIDDEN_TOPICS = {"new", "final", "latest", "test", "test2", "v2"}
SEMVER = r"(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)"

def module_scope(module_key: str) -> str:
    if not re.fullmatch(r"[a-z0-9]+(?:_[a-z0-9]+)*", module_key):
        raise ValueError(f"Invalid module key: {module_key}")
    return module_key.replace("_", "-")

def validate_branch_name(
    branch: str,
    *,
    module_key: str | None = None,
    repository_scope: str | None = None,
) -> list[str]:
    if branch in {"main", "master"}:
        return []

    if module_key and repository_scope:
        return ["QZ-VER-010: choose module_key or repository_scope, not both"]

    expected_scope = None
    if module_key:
        expected_scope = module_scope(module_key)
    elif repository_scope:
        if repository_scope not in {"repo", "standards"}:
            return [f"QZ-VER-010: unsupported repository scope: {repository_scope}"]
        expected_scope = repository_scope

    if expected_scope:
        release_prefix = f"release/{expected_scope}-"
        if branch.startswith(release_prefix):
            version = branch[len(release_prefix):]
            if re.fullmatch(SEMVER, version):
                return []
            return ["QZ-VER-012: release branch must end with MAJOR.MINOR.PATCH"]

        normal_match = re.fullmatch(
            rf"(?P<type>{'|'.join(NORMAL_TYPES)})/(?P<body>[a-z0-9]+(?:-[a-z0-9]+)*)",
            branch,
        )
        if not normal_match:
            return ["QZ-VER-012: branch does not match canonical naming grammar"]

        body = normal_match.group("body")
        prefix = f"{expected_scope}-"
        if not body.startswith(prefix):
            return [f"QZ-VER-011: branch scope must be {expected_scope}"]

        topic = body[len(prefix):]
        if not topic:
            return ["QZ-VER-012: branch topic is required"]
    else:
        release = re.fullmatch(
            rf"release/(?P<scope>[a-z0-9]+(?:-[a-z0-9]+)*)-(?P<version>{SEMVER})",
            branch,
        )
        if release:
            return []

        normal = re.fullmatch(
            rf"(?P<type>{'|'.join(NORMAL_TYPES)})/"
            r"(?P<body>[a-z0-9]+(?:-[a-z0-9]+)*)",
            branch,
        )
        if not normal:
            return ["QZ-VER-012: branch does not match canonical naming grammar"]
        body = normal.group("body")
        if "-" not in body:
            return ["QZ-VER-012: branch must contain scope and topic"]
        _, topic = body.split("-", 1)

    if expected_scope and expected_scope.startswith("qizhi-"):
        return ["QZ-VER-013: branch scope must not repeat qizhi- prefix"]

    if topic in FORBIDDEN_TOPICS or topic.endswith("-final") or topic.endswith("-latest"):
        return [f"QZ-VER-014: ambiguous/free-form branch topic is forbidden: {topic}"]

    if re.search(r"(?:^|-)v?\d+\.\d+(?:\.\d+)?(?:$|-)", topic):
        return ["QZ-VER-015: normal development branch must not encode a version"]

    return []

def main() -> int:
    parser = argparse.ArgumentParser(description="Validate QiZhi branch naming.")
    parser.add_argument("branch")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--module-key")
    group.add_argument("--repository-scope", choices=["repo", "standards"])
    args = parser.parse_args()

    issues = validate_branch_name(
        args.branch,
        module_key=args.module_key,
        repository_scope=args.repository_scope,
    )
    if issues:
        print("QiZhi branch naming: FAIL")
        for issue in issues:
            print(f"- {issue}")
        return 1
    print("QiZhi branch naming: PASS")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
