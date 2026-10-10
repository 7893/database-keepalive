"""Shared keepalive row fields and idempotency conflict."""
FIELDS = ("id", "ping_time", "status", "colo", "country", "city", "region", "ip")
GEO_FIELDS = FIELDS[3:]


class Conflict(Exception):
    pass
