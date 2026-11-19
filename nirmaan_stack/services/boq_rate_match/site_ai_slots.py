# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The site-wide limit on AI calls in flight (#1718, spec #1654).

Every operation that sends model calls through the call runner (the rate match judge, the spec cards) takes one
slot here per call, on every worker. The slots live in the site's cache Redis, so N `long` workers together never
have more calls in flight than the limit (the setting match_site_calls_at_once). Each operation's own calls at once
(match_calls_at_once) stays its ceiling; the lower of the two holds.

A SLOT IS A LEASE. A slot is one member of a Redis sorted set, scored by the time its lease runs out. The runner
renews the slots it holds every RENEW_EVERY_S while their calls are in flight, and gives each back when its call
ends. A worker that dies renews nothing, so its slots run out after LEASE_S and are dropped by the next taker: a dead
worker lowers the limit for at most LEASE_S, never for good. Taking a slot drops the run-out leases and counts the
rest in one Lua script, so two workers can never both take the last slot.

The lease times are wall-clock seconds (time.time), the one clock every worker shares; `clock` is a seam for tests.
"""
from __future__ import annotations

import time
import uuid
from typing import Callable, Iterable

import frappe

LEASE_S = 120          # a slot nobody renews is free after this
RENEW_EVERY_S = 30     # the runner renews its slots this often, well inside the lease
WAIT_POLL_S = 0.2      # how often a run waiting for a free slot asks again

_KEY = "boq_ai_calls_in_flight"

# KEYS[1] the set; ARGV: now, limit, lease end, token, key expiry (s)
_TAKE = """
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
if redis.call('ZCARD', KEYS[1]) < tonumber(ARGV[2]) then
  redis.call('ZADD', KEYS[1], ARGV[3], ARGV[4])
  redis.call('EXPIRE', KEYS[1], ARGV[5])
  return 1
end
return 0
"""
# KEYS[1] the set; ARGV: lease end, key expiry (s), token... (XX: a slot that already ran out is not brought back)
_RENEW = """
for i = 3, #ARGV do
  redis.call('ZADD', KEYS[1], 'XX', ARGV[1], ARGV[i])
end
redis.call('EXPIRE', KEYS[1], ARGV[2])
return 1
"""


def slot_key() -> bytes:
    """The Redis key of this site's slots (the site's cache prefix: every site, and every dev env, has its own)."""
    return frappe.cache.make_key(_KEY)


class SiteSlots:
    """The site's slots under `limit`. Built where the site is known (the key is read once, so the methods also work
    from the runner's call threads, which carry no site)."""

    def __init__(self, limit: int, *, clock: Callable[[], float] = time.time):
        if limit < 1:
            raise ValueError("the site-wide calls at once must be 1 or more")
        self.limit = int(limit)
        self.clock = clock
        self.key = slot_key()
        self.redis = frappe.cache
        self._take = self.redis.register_script(_TAKE)
        self._renew = self.redis.register_script(_RENEW)

    def try_take(self) -> str | None:
        """A slot's token, or None when the site already has `limit` calls in flight."""
        token = uuid.uuid4().hex
        now = self.clock()
        took = self._take(keys=[self.key], args=[now, self.limit, now + LEASE_S, token, int(LEASE_S * 2)])
        return token if took else None

    def renew(self, tokens: Iterable[str]) -> None:
        """Push the lease of each held slot LEASE_S past now."""
        tokens = list(tokens)
        if tokens:
            self._renew(keys=[self.key], args=[self.clock() + LEASE_S, int(LEASE_S * 2), *tokens])

    def give_back(self, token: str) -> None:
        """Free the slot `token` names, once its call has ended. A token whose lease already ran out (and was dropped
        by a taker) is a no-op."""
        self.redis.zrem(self.key, token)

    def in_flight(self) -> int:
        """Slots held now, run-out leases left out."""
        return self.redis.zcount(self.key, f"({self.clock()}", "+inf")
