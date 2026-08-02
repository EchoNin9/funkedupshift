"""
Pluggable publisher interface. This is the seam Instagram and (later)
Threads slot in behind without any change to calling code: implement
Publisher, register the class in PUBLISHERS under a platform name, done.
"""
from abc import ABC, abstractmethod
from dataclasses import dataclass, field


@dataclass
class PublishRequest:
    accountId: str
    text: str
    media: list = field(default_factory=list)  # [{"bytes": b"...", "mimeType": "image/jpeg", "alt": "..."}]
    links: list = field(default_factory=list)  # [str, ...]
    overrides: dict = field(default_factory=dict)  # platform-specific payload tweaks


@dataclass
class PublishResult:
    ok: bool
    permalink: str = None
    platformPostId: str = None
    error: str = None


class Publisher(ABC):
    """Base class every platform publisher implements."""

    platform: str = ""

    @abstractmethod
    def validate(self, request: PublishRequest) -> list:
        """Return a list of human-readable validation errors (empty list = valid).

        Must not perform network I/O — this is a pre-flight check the
        handler runs before attempting to publish.
        """
        raise NotImplementedError

    @abstractmethod
    def publish(self, request: PublishRequest) -> PublishResult:
        """Publish the request to the platform, returning a PublishResult.

        Should never raise for expected failure modes (HTTP errors, network
        errors, API-reported errors) — those come back as
        PublishResult(ok=False, error=...).
        """
        raise NotImplementedError


class UnknownPublisherError(Exception):
    """Raised when getPublisher() is asked for a platform with no registered publisher."""


# platform name -> Publisher subclass. Populated by importing
# social.publishers (each publisher module registers itself on import) —
# see social/publishers/__init__.py. Callers should go through
# getPublisher(), not import a concrete publisher class directly.
PUBLISHERS: dict = {}


def getPublisher(platform):
    """Look up a registered Publisher class by platform name."""
    try:
        return PUBLISHERS[platform]
    except KeyError:
        raise UnknownPublisherError(f"No publisher registered for platform '{platform}'") from None
