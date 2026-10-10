"""Authenticated, fixed-operation HTTP bridge; bind only to loopback."""
import hmac
import json
import os
import re
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit
from uuid import UUID

from db import Conflict, Db2

LIMITS = {"colo": 16, "country": 8, "city": 512, "region": 512, "ip": 128}


def checkin_payload(body):
    if not isinstance(body, dict) or set(body) - {*LIMITS, "request_id"}:
        raise ValueError("invalid_fields")
    request_id = body.get("request_id")
    if not isinstance(request_id, str) or str(UUID(request_id)) != request_id:
        raise ValueError("invalid_request_id")
    geo = {}
    for field, maximum in LIMITS.items():
        value = body.get(field)
        if value is not None and (not isinstance(value, str) or len(value.encode()) > maximum):
            raise ValueError("invalid_field")
        geo[field] = value
    return request_id, geo


def pagination(query):
    params = parse_qs(query, keep_blank_values=True)
    if set(params) - {"page", "limit"}:
        raise ValueError("invalid_query")
    values = []
    for name, default, maximum in [("page", "1", 10000), ("limit", "10", 100)]:
        raw = params.get(name, [default])
        if len(raw) != 1 or not re.fullmatch(r"[0-9]{1,5}", raw[0]):
            raise ValueError("invalid_pagination")
        value = int(raw[0])
        if not 1 <= value <= maximum:
            raise ValueError("invalid_pagination")
        values.append(value)
    return values


class Handler(BaseHTTPRequestHandler):
    server_version = "KeepaliveBridge"
    sys_version = ""

    def setup(self):
        super().setup()
        self.connection.settimeout(10)

    def log_message(self, *_args):
        pass

    def reply(self, status, body):
        payload = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(payload)

    def handle_request(self):
        url = urlsplit(self.path)
        route = self.server.routes.get(url.path)
        if route is None:
            return self.reply(404, {"ok": False, "error": "not_found"})
        db, token, slots, service = route
        expected = ("Bearer " + token).encode()
        supplied = self.headers.get("Authorization", "").encode()
        if not hmac.compare_digest(expected, supplied):
            return self.reply(401, {"ok": False, "error": "unauthorized"})
        if not slots.acquire(blocking=False):
            return self.reply(503, {"ok": False, "error": "busy"})
        try:
            if self.command == "GET":
                data = db.query(*pagination(url.query))
                return self.reply(200, data)
            if url.query or self.headers.get_content_type() != "application/json":
                raise ValueError("invalid_content_type")
            raw_length = self.headers.get("Content-Length", "")
            if not re.fullmatch(r"[0-9]{1,5}", raw_length):
                raise ValueError("invalid_length")
            length = int(raw_length)
            if length < 1 or length > 4096 or self.headers.get("Transfer-Encoding"):
                raise ValueError("invalid_length")
            body = json.loads(self.rfile.read(length))
            result = db.checkin(*checkin_payload(body))
            return self.reply(201, result)
        except (ValueError, UnicodeError):
            self.reply(400, {"ok": False, "error": "invalid_request"})
        except Conflict:
            self.reply(409, {"ok": False, "error": "request_id_reused"})
        except Exception:
            print(json.dumps({"event": "bridge_request_failed", "service": service}), flush=True)
            self.reply(502, {"ok": False, "error": "database_error"})
        finally:
            slots.release()

    do_GET = handle_request
    do_POST = handle_request


def make_server(db=None, token=None, port=8172, *, mysql_db=None, mysql_token=None):
    if db is not None and mysql_db is not None and token == mysql_token:
        raise ValueError("bridge_tokens_must_differ")
    routes = {}
    for path, backend, secret, name in [
        ("/v1/checkins", db, token, "db2"),
        ("/v1/mysql/checkins", mysql_db, mysql_token, "mysql"),
    ]:
        if backend is not None:
            if not isinstance(secret, str) or len(secret) < 32:
                raise ValueError("bridge_token_too_short")
            routes[path] = (backend, secret, threading.BoundedSemaphore(4), name)
    if not routes:
        raise ValueError("no_bridge_services")
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    server.routes = routes
    return server


def configured_server():
    services = {s.strip() for s in os.environ.get("BRIDGE_SERVICES", "db2").split(",")}
    if not services or services - {"db2", "mysql"}:
        raise ValueError("invalid_bridge_services")
    mysql = None
    if "mysql" in services:
        from mysql_db import MySQL
        mysql = MySQL()
    return make_server(
        Db2() if "db2" in services else None, os.environ.get("DB2_BRIDGE_TOKEN"),
        int(os.environ.get("BRIDGE_PORT", "8172")),
        mysql_db=mysql, mysql_token=os.environ.get("MYSQL_BRIDGE_TOKEN"))


if __name__ == "__main__":
    with configured_server() as server:
        print('{"event":"bridge_ready"}', flush=True)
        server.serve_forever()
