"""
Pluggable social publisher registry.

Importing this package registers every built-in publisher into
base.PUBLISHERS. Callers (handler.py, tests, the CLI script) should import
getPublisher from here rather than importing a concrete publisher class —
that's what keeps Instagram/Threads pluggable later.
"""
from social.publishers.base import (  # noqa: F401
    PublishRequest,
    PublishResult,
    Publisher,
    PUBLISHERS,
    getPublisher,
    UnknownPublisherError,
)
from social.publishers import bluesky  # noqa: F401  (import-time side effect: registers BlueskyPublisher)
