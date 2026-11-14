#!/usr/bin/env python3
"""
FUNK-90: list existing sites whose URLs collide under the add-site dedupe rules.

  python3 scripts/find_duplicate_sites.py                       # prod (reads https://funkedupshift.com/config.js)
  python3 scripts/find_duplicate_sites.py --api-base https://...execute-api...amazonaws.com
  python3 scripts/find_duplicate_sites.py --json > dupes.json

READ-ONLY: one unauthenticated GET /sites (public, returns every site since PR #187).
Uses api.site_urls.normalize_site_url, the same normalization the createSite 409 gate
uses, so a group printed here is exactly what the gate would now reject.
Exit code: 0 = no duplicates, 1 = duplicates found, 2 = error.
"""
import argparse
import json
import os
import re
import sys
import urllib.request

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src", "lambda"))
from api.site_urls import normalize_site_url  # noqa: E402

DEFAULT_SITE = "https://funkedupshift.com"


def _get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "funkedupshift-dupe-audit"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8")


def discover_api_base(site):
    js = _get(f"{site.rstrip('/')}/config.js")
    m = re.search(r'API_BASE_URL\s*=\s*["\']([^"\']+)["\']', js)
    if not m or "PLACEHOLDER" in m.group(1):
        raise RuntimeError(f"could not find API_BASE_URL in {site}/config.js")
    return m.group(1).rstrip("/")


def group_duplicates(sites):
    """Return {normalized_url: [site, ...]} for groups with more than one site."""
    groups = {}
    for s in sites:
        key = normalize_site_url(s.get("url") or "")
        if key:
            groups.setdefault(key, []).append(s)
    return {k: v for k, v in groups.items() if len(v) > 1}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--site", default=DEFAULT_SITE, help="site whose /config.js names the API (default: prod)")
    ap.add_argument("--api-base", help="API base URL; skips config.js discovery")
    ap.add_argument("--json", action="store_true", help="machine-readable output")
    a = ap.parse_args()
    try:
        base = a.api_base.rstrip("/") if a.api_base else discover_api_base(a.site)
        body = json.loads(_get(f"{base}/sites"))
    except Exception as e:  # noqa: BLE001
        print(f"error: {e}", file=sys.stderr)
        return 2
    sites = body.get("sites") if isinstance(body, dict) else None
    # listSites can answer 200 with {"sites": [], "error": ...}; never report that as "no duplicates"
    if not isinstance(sites, list) or (isinstance(body, dict) and body.get("error")) or not sites:
        print(f"error: unusable /sites response: {str(body)[:300]}", file=sys.stderr)
        return 2
    dupes = group_duplicates(sites)
    if a.json:
        print(json.dumps({"siteCount": len(sites), "groups": [
            {"normalizedUrl": k, "sites": [{"id": s.get("PK"), "title": s.get("title"), "url": s.get("url"),
                                            "averageRating": s.get("averageRating"),
                                            "createdAt": s.get("createdAt"),
                                            "description": s.get("description")} for s in v]}
            for k, v in sorted(dupes.items())]}, indent=2))
    else:
        print(f"{len(sites)} sites, {len(dupes)} duplicate group(s)")
        for k, v in sorted(dupes.items()):
            print(f"\n== {k}")
            for s in v:
                desc = (s.get("description") or "").replace("\n", " ")[:80]
                print(f"  {s.get('PK')}  rating={s.get('averageRating') or '-'}  created={s.get('createdAt') or '-'}"
                      f"  {s.get('title')!r}  {s.get('url')}\n      {desc!r}")
    return 1 if dupes else 0


if __name__ == "__main__":
    sys.exit(main())
