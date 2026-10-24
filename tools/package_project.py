#!/usr/bin/env python3
"""
FUSE-safe project packager for Gemini Task Sandbox VM (tools/package_project.py).

Why this script exists:
In the Gemini Task Sandbox VM's FUSE filesystem, `os.walk()` / `readdir` on an
extracted directory may NOT list newly created files (such as `world-worker.js`,
`trading.js`, or newly written `.git/objects/<xx>/<yy>` loose objects) even though
`os.path.exists(path)` is True!
This script combines:
1. `os.walk()` for existing directory trees (including `.git/`)
2. `git rev-list --objects --all` for exact-path lookup of all loose `.git/objects/`
3. `git ls-files` for tracked working-tree files
4. `<script src="...">` parsed directly from `game/index.html`
5. Explicit verification assertions on the resulting ZIP archive
"""
import os
import re
import subprocess
import sys
import zipfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DEFAULT_OUT = os.path.abspath(
    os.path.join(ROOT, "../../artifacts/file_generation/ttl=63d/output/OpusMC_Git_Project.zip")
)


def collect_files(root_dir: str):
  rel_files = set()

  # 1. Walk filesystem (includes .git metadata)
  for dirpath, dirnames, filenames in os.walk(root_dir):
    dirnames[:] = [d for d in dirnames if d not in ("__pycache__", "node_modules")]
    for fn in filenames:
      if fn.endswith((".pyc", ".DS_Store", ".zip")):
        continue
      full = os.path.join(dirpath, fn)
      rel = os.path.relpath(full, root_dir).replace("\\", "/")
      rel_files.add(rel)

  # 2. Query all reachable git objects via `git rev-list --objects --all` (immune to FUSE readdir cache on .git/objects)
  try:
    obj_out = subprocess.check_output(["git", "rev-list", "--objects", "--all"], cwd=root_dir, text=True)
    for line in obj_out.splitlines():
      parts = line.strip().split()
      if parts and len(parts[0]) == 40:
        oid = parts[0]
        obj_rel = f".git/objects/{oid[:2]}/{oid[2:]}"
        if os.path.exists(os.path.join(root_dir, obj_rel)):
          rel_files.add(obj_rel)
  except Exception as e:
    print(f"[WARN] git rev-list failed: {e}", file=sys.stderr)

  # 3. Query git ls-files (immune to FUSE readdir cache)
  try:
    out = subprocess.check_output(["git", "ls-files"], cwd=root_dir, text=True)
    for line in out.splitlines():
      line = line.strip()
      if line and not line.endswith(".zip") and os.path.exists(os.path.join(root_dir, line)):
        rel_files.add(line)
  except Exception as e:
    print(f"[WARN] git ls-files failed: {e}", file=sys.stderr)

  # 4. Parse <script src="..."> from game/index.html
  index_html_path = os.path.join(root_dir, "game", "index.html")
  with open(index_html_path, "r", encoding="utf-8") as f:
    html = f.read()
  script_srcs = re.findall(r'<script\s+src="([^"]+)"></script>', html)
  for src in script_srcs:
    rel = f"game/{src}"
    full = os.path.join(root_dir, rel)
    if not os.path.exists(full):
      raise FileNotFoundError(f"FATAL: Script referenced in game/index.html is missing on disk: {rel}")
    rel_files.add(rel)

  # 5. Explicit known docs & tools check
  for candidate in [
      "README.md",
      ".gitignore",
      "docs/01-current-state-audit.md",
      "docs/02-project-design.md",
      "docs/03-agent-sandbox-guide.md",
      "tools/build_from_pack.py",
      "tools/verify_all.js",
      "tools/package_project.py",
  ]:
    if os.path.exists(os.path.join(root_dir, candidate)):
      rel_files.add(candidate)

  return rel_files, script_srcs


def build_zip(out_path: str = DEFAULT_OUT) -> None:
  os.makedirs(os.path.dirname(out_path), exist_ok=True)
  rel_files, script_srcs = collect_files(ROOT)

  with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as zf:
    for rel in sorted(rel_files):
      full = os.path.join(ROOT, rel)
      if os.path.isfile(full):
        zf.write(full, f"OpusMC/{rel}")

  # Audit the generated ZIP archive
  with zipfile.ZipFile(out_path, "r") as zf:
    names = set(zf.namelist())
    for src in script_srcs:
      expected = f"OpusMC/game/{src}"
      assert expected in names, f"FATAL: Missing script in ZIP: {expected}"
    assert "OpusMC/game/index.html" in names, "FATAL: Missing OpusMC/game/index.html in ZIP"
    assert "OpusMC/README.md" in names, "FATAL: Missing OpusMC/README.md in ZIP"

  size_mb = os.path.getsize(out_path) / (1024 * 1024)
  print(f"[PASS] Packaged {len(rel_files)} files into {out_path} ({size_mb:.2f} MiB)")
  print(f"[PASS] Verified all {len(script_srcs)} <script> files from game/index.html inside ZIP")


if __name__ == "__main__":
  target = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_OUT
  build_zip(os.path.abspath(target))
