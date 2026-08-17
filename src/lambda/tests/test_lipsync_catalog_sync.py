"""Guards the hand-synced frontend mirror of the fal model catalog.

`providers/fal.py::MODEL_CATALOG` is the authority for which models exist,
what mode each belongs to, and which require a prompt. The SPA's picker
(`features/lipsync/statusStyles.ts::MODEL_CATALOG`) mirrors it by hand,
because the frozen API contract has no catalog-listing route to fetch from.

Hand-synced mirrors drift. Drift here is not catastrophic -- routes.createJob
re-validates every model server side, so an extra entry in the mirror produces
a visible 400 rather than a bad fal call -- but a MISSING entry silently hides
a model the backend supports, and a wrong `promptRequired` lets the form submit
something the server will reject.

Same idea as test_route_coverage.py: regex one file, compare against the other,
fail on divergence.
"""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

REPO_ROOT = Path(__file__).resolve().parents[3]
TS_CATALOG = REPO_ROOT / "src" / "web" / "spa" / "src" / "features" / "lipsync" / "statusStyles.ts"


def _tsCatalogEntries():
    """Parse {modelId: {mode, promptRequired}} out of the TS MODEL_CATALOG block."""
    source = TS_CATALOG.read_text(encoding="utf-8")

    start = source.index("export const MODEL_CATALOG")
    openBrace = source.index("{", start)
    depth, end = 0, None
    for i in range(openBrace, len(source)):
        if source[i] == "{":
            depth += 1
        elif source[i] == "}":
            depth -= 1
            if depth == 0:
                end = i
                break
    assert end is not None, "could not find the end of the TS MODEL_CATALOG object"
    block = source[openBrace : end + 1]

    entries = {}
    # Each entry looks like:  "model/id": { mode: "avatar", ... promptRequired: false, },
    for match in re.finditer(r'"([^"]+)"\s*:\s*\{(.*?)\n\s*\},', block, re.DOTALL):
        modelId, body = match.group(1), match.group(2)
        mode = re.search(r'mode:\s*"([^"]+)"', body)
        promptRequired = re.search(r"promptRequired:\s*(true|false)", body)
        entries[modelId] = {
            "mode": mode.group(1) if mode else None,
            "promptRequired": promptRequired.group(1) == "true" if promptRequired else None,
        }
    return entries


def test_frontend_mirror_lists_exactly_the_backend_models():
    from lipsync.providers.fal import MODEL_CATALOG

    ts = _tsCatalogEntries()
    assert ts, "parsed no entries out of statusStyles.ts -- the regex or the file shape changed"

    missing = set(MODEL_CATALOG) - set(ts)
    extra = set(ts) - set(MODEL_CATALOG)
    assert not missing, f"models in the backend catalog but missing from the SPA picker: {sorted(missing)}"
    assert not extra, f"models offered by the SPA picker that the backend will reject: {sorted(extra)}"


def test_frontend_mirror_agrees_on_mode_and_prompt_required():
    from lipsync.providers.fal import MODEL_CATALOG

    ts = _tsCatalogEntries()
    for modelId, backend in MODEL_CATALOG.items():
        assert ts[modelId]["mode"] == backend["mode"], (
            f"{modelId}: SPA says mode={ts[modelId]['mode']!r}, backend says {backend['mode']!r} "
            f"-- a cross-mode model in the picker is a guaranteed 400"
        )
        assert ts[modelId]["promptRequired"] == backend["promptRequired"], (
            f"{modelId}: SPA says promptRequired={ts[modelId]['promptRequired']!r}, "
            f"backend says {backend['promptRequired']!r} -- the form would let a "
            f"prompt-less job through that the server rejects"
        )


def test_frontend_mirror_agrees_on_defaults():
    from lipsync.providers.fal import DEFAULT_MODELS

    source = TS_CATALOG.read_text(encoding="utf-8")
    start = source.index("export const DEFAULT_MODELS")
    block = source[start : source.index("};", start)]

    for mode, modelId in DEFAULT_MODELS.items():
        found = re.search(rf'{mode}:\s*"([^"]+)"', block)
        assert found, f"SPA DEFAULT_MODELS has no entry for mode={mode!r}"
        assert found.group(1) == modelId, (
            f"default for {mode}: SPA says {found.group(1)!r}, backend says {modelId!r}"
        )
