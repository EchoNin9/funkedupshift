"""
Pluggable lipsync provider registry.

Importing this package registers every built-in provider into
base.PROVIDERS. Callers (runner.py, tests) should import getProvider from
here rather than importing a concrete provider class directly -- that's what
keeps a second provider pluggable later. Mirrors social/publishers/__init__.py.
"""
from lipsync.providers.base import (  # noqa: F401
    KNOWN_STATES,
    RUNNING_STATES,
    STATE_COMPLETED,
    STATE_FAILED,
    STATE_IN_PROGRESS,
    STATE_IN_QUEUE,
    LipsyncProvider,
    PROVIDERS,
    ProviderError,
    StatusResult,
    SubmitResult,
    UnknownProviderError,
    ValidationError,
    getProvider,
)
from lipsync.providers import fal  # noqa: F401  (import-time side effect: registers FalProvider)
