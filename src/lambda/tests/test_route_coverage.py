"""Guard against API handler / API Gateway route drift.

Routes are maintained in TWO places that must agree:
  1. dispatch in a handler module (`method == "X" and path == "/y"`)
  2. `aws_apigatewayv2_route` resources somewhere in `infra/*.tf`
     (`route_key = "X /y"`)

A handler route with no matching gateway route 404s at the gateway *without*
CORS headers, surfacing in the browser as a misleading "Failed to fetch"
(this happened with PUT /branding/banner; see FUNK-15). This test extracts the
literal routes from every known handler and fails if a handler declares one
the gateway doesn't expose.

Best-effort by design: only literal `path == "..."` dispatches are checked.
Dynamic routes (`path.startswith(...)`, path params) can't be matched
statically and are skipped — see each handler's entry in HANDLERS for paths
that map to a parameterised gateway route.

Checks every handler in HANDLERS (currently `api/handler.py` — the main app
API — and `tools/handler.py` — the isolated URL-shortener/tools API, see
docs/tools-platform-phase1-brief.md) against the combined route set from all
`infra/*.tf` files, since gateway routes for a given handler may live in
either `main.tf` or a dedicated file like `tools.tf`.
"""
import re
from pathlib import Path

LAMBDA_DIR = Path(__file__).resolve().parents[1]
INFRA_DIR = Path(__file__).resolve().parents[3] / "infra"

# (handler file, known-dynamic-skips) pairs. A skip entry is a literal
# (method, path) the handler serves via a parameterised gateway route (e.g.
# handler checks `path == "/sites"` but also a `{id}` variant exists) — add
# only when a real mapping exists; keep empty otherwise.
HANDLERS: list[tuple[Path, set[tuple[str, str]]]] = [
    (LAMBDA_DIR / "api" / "handler.py", {
        ("GET", "/admin/stats"),
        ("POST", "/admin/stats/recompute"),
    }),
    (LAMBDA_DIR / "tools" / "handler.py", set()),
]


def _handler_routes(handler_path: Path) -> set[tuple[str, str]]:
    src = handler_path.read_text(encoding="utf-8")
    routes = set()
    for line in src.splitlines():
        m_method = re.search(r'method == "(\w+)"', line)
        m_path = re.search(r'path == "(/[^"]*)"', line)
        if m_method and m_path:
            routes.add((m_method.group(1), m_path.group(1)))
    return routes


def _gateway_routes() -> set[tuple[str, str]]:
    routes = set()
    for tf_file in sorted(INFRA_DIR.glob("*.tf")):
        src = tf_file.read_text(encoding="utf-8")
        for m in re.finditer(r'route_key\s*=\s*"(\w+)\s+(/[^"]*)"', src):
            routes.add((m.group(1), m.group(2)))
    return routes


def test_every_handler_route_has_a_gateway_route():
    gateway_routes = _gateway_routes()
    assert gateway_routes, f"No gateway routes parsed from {INFRA_DIR}/*.tf"

    for handler_path, known_dynamic_skips in HANDLERS:
        handler_routes = _handler_routes(handler_path)
        assert handler_routes, f"No handler routes parsed from {handler_path}"

        missing = handler_routes - gateway_routes - known_dynamic_skips
        assert not missing, (
            f"{handler_path} dispatches routes with no matching aws_apigatewayv2_route "
            f"in infra/*.tf (add the route, or extend its known_dynamic_skips if "
            f"parameterised): {sorted(missing)}"
        )
