#!/usr/bin/env python3
"""
Serve a built static site with its own `_headers` file actually applied, so a
CSP can be verified locally instead of discovered in production.

Cloudflare's static-assets runtime reads `_headers` from the asset directory.
`python -m http.server` ignores it entirely, which means a CSP that blocks the
app looks perfectly fine locally.

    serve-with-headers.py --dir dist --port 4321
"""

import argparse
import fnmatch
import http.server
import os

CHARSET_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".mjs": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".map": "application/json; charset=utf-8",
}


def parse_headers_file(path):
    """Returns [(url_pattern, [(name, value), ...]), ...] in file order."""
    rules = []
    if not os.path.exists(path):
        return rules
    current = None
    for raw in open(path, encoding="utf-8"):
        line = raw.rstrip("\n")
        if not line.strip() or line.strip().startswith("#"):
            continue
        if not line[0].isspace():
            current = (line.strip(), [])
            rules.append(current)
        elif current is not None and ":" in line:
            name, _, value = line.strip().partition(":")
            current[1].append((name.strip(), value.strip()))
    return rules


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", required=True)
    ap.add_argument("--port", type=int, default=4321)
    args = ap.parse_args()

    root = os.path.abspath(args.dir)
    rules = parse_headers_file(os.path.join(root, "_headers"))
    print(f"loaded {len(rules)} header rule(s) from _headers")
    for pat, hs in rules:
        print(f"  {pat}")
        for n, v in hs:
            print(f"      {n}: {v[:80]}{'...' if len(v) > 80 else ''}")

    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **kw):
            super().__init__(*a, directory=root, **kw)

        def guess_type(self, path):
            _, ext = os.path.splitext(str(path).lower())
            return CHARSET_TYPES.get(ext) or super().guess_type(path)

        def end_headers(self):
            url = self.path.split("?")[0]
            for pattern, hs in rules:
                # Cloudflare's globbing; only `/*` suffixes are used here.
                if fnmatch.fnmatch(url, pattern) or (
                    pattern.endswith("/*") and url.startswith(pattern[:-1])
                ):
                    for name, value in hs:
                        self.send_header(name, value)
            self.send_header("Cache-Control", "no-store")
            super().end_headers()

        def log_message(self, *a):
            pass

    http.server.ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
