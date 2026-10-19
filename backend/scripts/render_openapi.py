#!/usr/bin/env python3
"""Render ``api/openapi.yaml`` for API Gateway by substituting ``${NAME}`` tokens.

Backend URLs and the Identity Platform project ID are configuration, so they are
kept out of the specification itself.  Every token must be provided through the
environment; a missing value is an error (no silent placeholders are deployed).

Usage::

    python3 scripts/render_openapi.py --output build/openapi-rendered.yaml
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path

TOKEN_RE = re.compile(r"\$\{([A-Z][A-Z0-9_]*)\}")
ROOT = Path(__file__).resolve().parent.parent


def render(template: str, env: "os._Environ[str] | dict") -> str:
    missing = sorted({m for m in TOKEN_RE.findall(template) if not env.get(m)})
    if missing:
        raise SystemExit("ERROR: missing values for: " + ", ".join(missing))

    def substitute(match: "re.Match[str]") -> str:
        value = env[match.group(1)].strip()
        if any(ch in value for ch in '"\n\r\\'):
            raise SystemExit(f"ERROR: value for {match.group(1)} contains unsafe characters")
        return value

    return TOKEN_RE.sub(substitute, template)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", default=str(ROOT / "api" / "openapi.yaml"))
    parser.add_argument("--output", default="-")
    args = parser.parse_args()

    rendered = render(Path(args.input).read_text(encoding="utf-8"), os.environ)
    if args.output == "-":
        sys.stdout.write(rendered)
    else:
        out = Path(args.output)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(rendered, encoding="utf-8")
        print(f"Rendered {args.input} -> {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
