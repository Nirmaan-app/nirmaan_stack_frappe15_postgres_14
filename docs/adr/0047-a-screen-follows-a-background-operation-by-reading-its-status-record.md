# ADR 0047 — A screen follows a background operation by reading its status record, not by trusting live messages

**Status:** Accepted · 2026-11-08 (grill with the owner, round 2 Q6) · Spec #1654

A screen that starts a **background operation** (a TDS export, a BoQ upload's parse, a sheet's classification, a rate
suggestion) must keep working when more than one worker runs operations at once. Today 16 flows each follow their
operation with hand-written socket code; 5 already take another operation's result or give up early with one worker,
and live messages sent while a socket is down are lost for good (Redis pub/sub, no replay).

We decided that every operation has a **status record**, written before it is queued and readable only by the user
who started it. The screen reads that record on a short interval; a live message carrying the operation's id only
tells the screen to read the record sooner, and its contents are never taken as the result. The record says queued,
running, finished, failed, or lost (its worker died), so a screen shows waiting in the queue apart from running and
gives up only after queue wait plus the operation's time limit.

We rejected live messages as the source of truth (lost on disconnect; ordering and matching bugs measured with 2
workers), Frappe's built-in progress rooms (`task_subscribe` lets any signed-in socket that knows the id join, the
room is not re-joined after a reconnect, and its events go out before the database commit), and RQ's own job status
(forgotten 10 minutes after the job ends; its endpoints are System Manager only).

The cost: each open operation polls (20 requests a minute at a 3-second interval, fewer while the socket is up), and
the status record outlives RQ's memory, so it needs its own expiry. The investigation's evidence is summarised in spec #1654.
