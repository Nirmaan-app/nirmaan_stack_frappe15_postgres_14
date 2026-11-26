"""VAV-2c1 (R13, earned in VAV-2b2) -- A TEST HARNESS NEVER HOLDS AN AI KEY, NOT EVEN A DUMMY ONE.

VAV-2b2's hand-written run patched the key getter to return "stub-no-key": a code path that slipped past the stubbed model would have
gone on to make a call. `no_key()` makes every copy of the getter RAISE instead, wherever a module imported it, so a harness that reaches
for a key stops there. Use it around any run that must make no model call:

    from no_key import no_key
    with no_key():
        ...
"""
import sys
from contextlib import contextmanager
from unittest import mock

NAME = "get_boq_ai_api_key"
HOME = "nirmaan_stack.api.boq.wizard.ai_settings"


class NoKeyInAHarness(RuntimeError):
    """The harness asked for the AI key: nothing in a stubbed run may."""


def refuse(*_args, **_kwargs):
    raise NoKeyInAHarness("a test harness asked for the AI key - no model call is allowed here")


@contextmanager
def no_key():
    """Every loaded module's `get_boq_ai_api_key` (the home module's and each `from ... import` copy) raises inside the block."""
    __import__(HOME)
    targets = [m for m in list(sys.modules.values()) if m is not None and callable(getattr(m, "__dict__", {}).get(NAME))]
    patches = [mock.patch.object(m, NAME, refuse) for m in targets]
    for p in patches:
        p.start()
    try:
        yield [m.__name__ for m in targets]
    finally:
        for p in reversed(patches):
            p.stop()
