#!/usr/bin/env python3
"""PreToolUse(Edit|Write) guard: block edits to .env files. Exit 1 = block."""
import sys, json

try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(0)

fp = data.get("file_path", "") or data.get("tool_input", {}).get("file_path", "")
sys.exit(1 if ".env" in fp else 0)
