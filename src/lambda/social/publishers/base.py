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
    # Stable per (postId, platform, accountId) key. Publishers that support a
    # deterministic record key (e.g. Bluesky's AT Protocol rkey) use this to
    # make a maintenance-sweep republish of a crashed-mid-publish target land
    # on the SAME record instead of creating a duplicate post. Defaulted so
    # every existing caller/test keeps constructing PublishRequest unchanged.
    idempotencyKey: str = ""
    # ISO-8601 UTC scheduledAt of the parent post -- carried alongside
    # idempotencyKey so a deterministic record key can be anchored to the
    # real-world time the post was meant to go out. Also defaulted for the
    # same backward-compatibility reason.
    scheduledAt: str = ""
    # Optional callable(containerId: str) -> None, invoked by the publisher
    # (via storage.setTargetContainer) as soon as it has a resume handle --
    # BEFORE the platform publish call completes -- so a crash mid-publish
    # is recoverable. Defaulted so every existing caller/test is unaffected.
    onContainerCreated: object = None


@dataclass
class PublishResult:
    ok: bool
    permalink: str = None
    platformPostId: str = None
    error: str = None
    # True when the platform accepted the media but publishing is not yet
    # complete (e.g. Meta's async container processing for Reels/video).
    # The caller persists containerId and schedules a checkPending resume
    # rather than treating this as success or failure.
    pending: bool = False
    # OPAQUE resume handle for a pending publish. Treat as an opaque string
    # everywhere outside the publisher that produced it -- a publisher may
    # encode structured state (e.g. JSON) in it.
    containerId: str = ""
    # How long (seconds) to wait before the next checkPending call.
    checkAfterSec: int = 0


class Publisher(ABC):
    """Base class every platform publisher implements."""

    platform: str = ""

    # True  -> the fan-out loads raw bytes into the media items (Bluesky
    #          uploads blobs directly). This is the default so every
    #          existing publisher is unaffected.
    # False -> the fan-out supplies a presigned URL instead, and the
    #          publisher MUST NOT read the object into memory -- this exists
    #          because a 300MB video would OOM the 128MB publisher Lambda if
    #          loaded eagerly.
    needsMediaBytes: bool = True

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

    def checkPending(self, request: PublishRequest, containerId: str, checkCount: int) -> PublishResult:
        """Resume a pending publish, given the opaque containerId returned by
        a prior publish()/checkPending() call. NOT abstract -- platforms
        that never return pending=True never need to implement this; the
        default raises NotImplementedError so they are otherwise unaffected.
        """
        raise NotImplementedError(f"{type(self).__name__} does not support checkPending")


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
