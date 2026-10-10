"""Exercise actual HTTP parsing and dispatch without requiring a listening socket."""
import io
import json
import types
import unittest
from unittest.mock import MagicMock, patch

from db import Conflict
from server import Handler, make_server

DB2_TOKEN = "test-db2-token-with-at-least-32-characters"
MYSQL_TOKEN = "test-mysql-token-with-at-least-32-characters"
RID = "e2e4bb5d-d57c-45ef-a4ba-50342a3cd099"


class Transport:
    def __init__(self, request):
        self.request = io.BytesIO(request)
        self.response = io.BytesIO()

    def makefile(self, *_args):
        return self.request

    def sendall(self, data):
        self.response.write(data)

    def settimeout(self, _timeout):
        pass


class HttpDispatchTests(unittest.TestCase):
    def setUp(self):
        self.db2, self.mysql = MagicMock(), MagicMock()
        self.mysql.query.return_value = {"ok": True, "rows": [], "count": 0, "page": 2, "limit": 10}
        self.mysql.checkin.return_value = {"ok": True, "committed": True, "request_id": RID}
        self.db2.query.return_value = {"ok": True, "rows": [], "count": 0}
        with patch("server.ThreadingHTTPServer", return_value=types.SimpleNamespace()):
            self.server = make_server(self.db2, DB2_TOKEN, mysql_db=self.mysql, mysql_token=MYSQL_TOKEN)

    def request(self, path="/v1/mysql/checkins", token=MYSQL_TOKEN, payload=None):
        body = json.dumps(payload).encode() if payload is not None else b""
        method = "POST" if payload is not None else "GET"
        raw = (f"{method} {path} HTTP/1.1\r\nHost: localhost\r\n"
               f"Authorization: Bearer {token}\r\nContent-Type: application/json\r\n"
               f"Content-Length: {len(body)}\r\n\r\n").encode() + body
        transport = Transport(raw)
        Handler(transport, ("127.0.0.1", 0), self.server)
        headers, data = transport.response.getvalue().split(b"\r\n\r\n", 1)
        self.assertIn(b"Cache-Control: no-store", headers)
        return int(headers.split()[1]), json.loads(data)

    def test_tokens_are_isolated_and_success_routes_to_correct_backend(self):
        self.assertEqual(self.request(token=DB2_TOKEN)[0], 401)
        self.mysql.query.assert_not_called()
        self.assertEqual(self.request(path="/v1/checkins")[0], 401)
        self.db2.query.assert_not_called()
        self.assertEqual(self.request(path="/v1/mysql/checkins?page=2&limit=10")[0], 200)
        self.mysql.query.assert_called_once_with(2, 10)
        self.assertEqual(self.request(payload={"request_id": RID})[0], 201)
        self.mysql.checkin.assert_called_once()

    def test_bad_input_is_rejected_before_database_access(self):
        self.assertEqual(self.request(payload={"request_id": RID, "sql": "DROP TABLE x"})[0], 400)
        self.assertEqual(self.request(path="/v1/mysql/checkins?page=1&page=2")[0], 400)
        self.assertEqual(self.request(payload={"request_id": "invalid"})[0], 400)
        self.mysql.query.assert_not_called()
        self.mysql.checkin.assert_not_called()

    def test_database_failure_is_redacted_and_conflict_returns_409(self):
        self.mysql.checkin.side_effect = RuntimeError("private-database-password")
        self.assertEqual(self.request(payload={"request_id": RID}),
                         (502, {"ok": False, "error": "database_error"}))
        self.mysql.checkin.side_effect = Conflict("reused")
        self.assertEqual(self.request(payload={"request_id": RID})[0], 409)

    def test_mysql_concurrency_limit_keeps_db2_available(self):
        slots = self.server.routes["/v1/mysql/checkins"][2]
        for _ in range(4):
            slots.acquire()
        self.assertEqual(self.request()[0], 503)
        self.assertEqual(self.request(path="/v1/checkins", token=DB2_TOKEN)[0], 200)
        self.mysql.query.assert_not_called()


if __name__ == "__main__":
    unittest.main()
