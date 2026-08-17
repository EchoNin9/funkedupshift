"""
Pluggable lip-sync/video provider interface. This is the seam a second
vendor (or a second fal.ai model family) slots in behind without any change
to runner.py: implement LipsyncProvider, register the instance in PROVIDERS
under a provider name, done. Mirrors social/publishers/base.py.
"""
from abc import ABC, abstractmethod
from dataclasses import dataclass

# --- provider-facing states for StatusResult.state ---------------------------
# fal.ai's queue API vocabulary (see providers/fal.py) -- kept here, not in
# fal.py, so a second provider can reuse the same small state machine instead
# of inventing its own spelling for "still running".
STATE_IN_QUEUE = "IN_QUEUE"
STATE_IN_PROGRESS = "IN_PROGRESS"
STATE_COMPLETED = "COMPLETED"
STATE_FAILED = "FAILED"

RUNNING_STATES = {STATE_IN_QUEUE, STATE_IN_PROGRESS}
KNOWN_STATES = RUNNING_STATES | {STATE_COMPLETED, STATE_FAILED}


@dataclass
class SubmitResult:
    providerJobId: str
    statusUrl: str = ""


@dataclass
class StatusResult:
    state: str  # one of KNOWN_STATES
    outputUrl: str = ""
    error: str = ""


class ValidationError(Exception):
    """Raised by validate() (and modelFor()) when a job's inputs, mode, or
    requested model are unusable for this provider. Also raised directly by
    routes.createJob for a bad `model` override -- the caller always turns
    this into a 400, never a 500 (see routes.py's createJob)."""


class ProviderError(Exception):
    """Raised by submit() when the provider call fails outright (network
    error, non-2xx response, malformed response, missing expected fields).
    checkStatus() deliberately never raises this -- "still running" and
    "provider reported failure" are both ordinary polling outcomes it
    represents via StatusResult.state, not exceptions (mirrors
    social/publishers/instagram.py returning PublishResult(ok=False, ...)
    rather than raising for expected failure modes)."""


class LipsyncProvider(ABC):
    """Base class every lip-sync provider implements."""

    name: str = ""
    supportedModes: frozenset = frozenset()

    @abstractmethod
    def modelFor(self, mode: str, override: str = None) -> str:
        """Resolve the provider model id to use for `mode`. `override`, when
        given, is the optional client-supplied CreateJobInput.model -- raise
        ValidationError if it doesn't match a model this provider actually
        serves for that mode (never let client input pick an arbitrary
        provider-side model string)."""
        raise NotImplementedError

    def promptRequired(self, model: str) -> bool:
        """Whether `model` (a value previously returned by modelFor) requires
        a client-supplied prompt to submit successfully. Default False, not
        abstract -- most providers/models have no such requirement. Overridden
        by FalProvider, which answers from its MODEL_CATALOG (e.g.
        fal-ai/infinitalk requires one, every other current model doesn't).
        routes.createJob calls this -- through the provider instance, never by
        importing a concrete provider module -- to 400 a create-job request
        for a prompt-required model with no prompt, before a job row is ever
        written."""
        return False

    @abstractmethod
    def validate(self, job: dict) -> None:
        """Raise ValidationError if `job` (the DynamoDB job item, or an
        equivalent dict with at least mode/imageKey/videoKey/audioKey) is
        unusable for this provider. Must not perform network I/O."""
        raise NotImplementedError

    @abstractmethod
    def submit(self, job: dict, inputUrls: dict) -> SubmitResult:
        """Submit the job to the provider. `inputUrls` carries presigned S3
        GET URLs (never raw bytes) -- see runner._buildInputUrls. Raises
        ProviderError on failure; never returns a partial/error result."""
        raise NotImplementedError

    @abstractmethod
    def checkStatus(self, job: dict) -> StatusResult:
        """Poll the provider for `job`'s current state (job["providerJobId"]
        / job["model"] identify the request). Returns a StatusResult --
        never raises; a provider-side failure or an unparseable response
        comes back as StatusResult(state=STATE_FAILED, error=...)."""
        raise NotImplementedError


class UnknownProviderError(Exception):
    """Raised when getProvider() is asked for a provider with no registered
    instance."""


# provider name -> LipsyncProvider instance. Populated by importing
# lipsync.providers (each provider module registers itself on import) -- see
# providers/__init__.py. Callers should go through getProvider(), not import
# a concrete provider class directly (mirrors social.publishers.PUBLISHERS).
PROVIDERS: dict = {}


def getProvider(name):
    """Look up a registered LipsyncProvider instance by provider name."""
    try:
        return PROVIDERS[name]
    except KeyError:
        raise UnknownProviderError(f"No lipsync provider registered for '{name}'") from None
