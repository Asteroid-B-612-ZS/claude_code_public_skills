from __future__ import annotations
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
from bootstrap import install
from audit import audit, STANDARDS_COMMIT
from validate_git_workflow import validate_subject, validate_pr
from validate_branch_name import validate_branch_name

PIN = "a" * 40

class GovernanceTests(unittest.TestCase):
    def test_conventional_titles_and_chinese(self):
        self.assertEqual([], validate_subject("feat(repo): establish audit", source="pr"))
        self.assertEqual([], validate_subject("docs(repo): 完善规范", source="pr"))
        self.assertTrue(validate_subject("Update release scripts", source="pr"))
        self.assertEqual([], validate_pr("docs(repo): test a", ["fix(repo): test b"]))

    def test_branch_rules(self):
        self.assertEqual([], validate_branch_name("docs/repo-setup", repository_scope="repo"))
        self.assertTrue(validate_branch_name("final", repository_scope="repo"))

    def test_bootstrap_and_audit(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "AGENTS.md").write_text("# Existing project rules\nKEEP ME\n", encoding="utf-8")
            changes = install(root, PIN, legacy=[7, 3, 7])
            self.assertIn("CLAUDE.md", changes)
            self.assertEqual([], audit(root))
            self.assertIn("KEEP ME", (root / "AGENTS.md").read_text(encoding="utf-8"))
            lock = json.loads((root / ".qizhi/governance.lock.json").read_text(encoding="utf-8"))
            self.assertEqual([3, 7], lock["legacy_pr_numbers"])
            self.assertEqual(STANDARDS_COMMIT, lock["standards_commit"])
            self.assertEqual([], audit(root))
            with self.assertRaises(FileExistsError):
                install(root, "b" * 40, legacy=[3, 7])
            install(root, "b" * 40, legacy=[3, 7], force=True)
            self.assertEqual([], audit(root))

    def test_detect_pin_tampering_and_missing_entrypoint(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            install(root, PIN, legacy=[])
            lock_path = root / ".qizhi/governance.lock.json"
            lock = json.loads(lock_path.read_text(encoding="utf-8"))
            lock["standards_commit"] = "b" * 40
            lock_path.write_text(json.dumps(lock), encoding="utf-8")
            self.assertTrue(any("QZ-ADOPT-003" in s for s in audit(root)))
            lock["standards_commit"] = STANDARDS_COMMIT
            lock_path.write_text(json.dumps(lock), encoding="utf-8")
            (root / "CLAUDE.md").unlink()
            self.assertTrue(any("QZ-ADOPT-006" in s for s in audit(root)))

if __name__ == "__main__":
    unittest.main()
