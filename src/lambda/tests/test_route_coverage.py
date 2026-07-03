"""Guard against API handler / API Gateway route drift.

Routes are maintained in TWO places that must agree:
  1. dispatch in `src/lambda/api/handler.py`  (`method == "X" and path == "/y"`)
  2. `aws_apigatewayv2_route` resources in `infra/main.tf`  (`route_key = "X /y"`)

A handler route with no matching gateway route 404s at the gateway *without*
CORS headers, surfacing in the browser as a misleading "Failed to fetch"
(this happened with PUT /branding/banner; see FUNK-15). This test extracts the
literal routes from both and fails if the handler declares one the gateway
doesn't expose.

Best-effort by design: only literal `path == "..."` dispatches are checked.
Dynamic routes (`path.startswith(...)`, path params) can't be matched
statically and are skipped — see KNOWN_DYNAMIC_SKIPS for handler paths that map
to a parameterised gateway route.
"""
import re
from pathlib import Path

HANDLER = Path(__file__).resolve().parents[1] / "api" / "handler.py"
MAIN_TF = Path(__file__).resolve().parents[3] / "infra" / "main.tf"

# Literal handler paths that are served by a parameterised gateway route
# (e.g. handler checks `path == "/sites"` but also a `{id}` variant exists).
# Add here only when a real mapping exists; keep empty otherwise.
KNOWN_DYNAMIC_SKIPS: set[tuple[str, str]] = set()


def _handler_routes() -> set[tuple[str, str]]:
    src = HANDLER.read_text(encoding="utf-8")
    routes = set()
    for line in src.splitlines():
        m_method = re.search(r'method == "(\w+)"', line)
        m_path = re.search(r'path == "(/[^"]*)"', line)
        if m_method and m_path:
            routes.add((m_method.group(1), m_path.group(1)))
    return routes


def _gateway_routes() -> set[tuple[str, str]]:
    src = MAIN_TF.read_text(encoding="utf-8")
    routes = set()
    for m in re.finditer(r'route_key\s*=\s*"(\w+)\s+(/[^"]*)"', src):
        routes.add((m.group(1), m.group(2)))
    return routes


def test_every_handler_route_has_a_gateway_route():
    handler_routes = _handler_routes()
    gateway_routes = _gateway_routes()

    # Sanity: make sure the parsers actually found routes (paths still valid).
    assert handler_routes, f"No handler routes parsed from {HANDLER}"
    assert gateway_routes, f"No gateway routes parsed from {MAIN_TF}"

    missing = handler_routes - gateway_routes - KNOWN_DYNAMIC_SKIPS
    assert not missing, (
        "Handler dispatches routes with no matching aws_apigatewayv2_route in "
        f"infra/main.tf (add the route, or KNOWN_DYNAMIC_SKIPS if parameterised): "
        f"{sorted(missing)}"
    )
