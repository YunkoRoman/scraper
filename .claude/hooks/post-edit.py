#!/usr/bin/env python3
"""PostToolUse(Edit|Write) auto-fix + verify hook.

On every edited TS/TSX file under the repo:
  1. prettier --write   (format the single file)
  2. eslint --fix       (auto-fix lint, print remaining errors)
For server-side src/*.ts (not client):
  3. vitest related     (run tests touching the file)
  4. tsc --noEmit       (type-check the project, print errors)

Never blocks (always exit 0); surfaces problems as printed output for the agent.
Shared by Claude Code (.claude/settings.json) and Codex (.codex/hooks.json).
"""
import sys, json, os, subprocess

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def read_file_path():
    try:
        data = json.load(sys.stdin)
    except Exception:
        return ""
    return data.get("file_path", "") or data.get("tool_input", {}).get("file_path", "")


def run(cmd, timeout, label, print_on_success=False):
    try:
        r = subprocess.run(cmd, cwd=REPO, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        print(f"[{label}] timed out after {timeout}s")
        return
    except FileNotFoundError:
        return  # tool not installed — skip silently
    if r.returncode != 0 or print_on_success:
        out = (r.stdout + r.stderr).strip()
        if out:
            print(f"[{label}]\n{out[:1500]}")


def main():
    fp = read_file_path()
    if not fp or not (fp.endswith(".ts") or fp.endswith(".tsx")):
        return
    # Ignore generated / vendored paths.
    if any(seg in fp for seg in ("/node_modules/", "/dist/", "/output/", "/migrations/")):
        return

    run(["npx", "prettier", "--write", fp], 30, "prettier")
    run(["npx", "eslint", "--fix", fp], 45, "eslint")

    is_server_src = "/src/" in fp and "/client/" not in fp
    if is_server_src:
        run(["npx", "vitest", "related", fp, "--run"], 60, "vitest")
        run(["npx", "tsc", "--noEmit"], 45, "tsc")


if __name__ == "__main__":
    main()
