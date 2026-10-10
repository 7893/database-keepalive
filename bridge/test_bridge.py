import contextlib
import json
import threading
import unittest
import urllib.error
import urllib.request
from unittest.mock import MagicMock

from db import Conflict, Db2, GEO_FIELDS
from server import checkin_payload, make_server, pagination

RID = "e2e4bb5d-d57c-45ef-a4ba-50342a3cd099"
GEO = dict(zip(GEO_FIELDS, ["SIN", "SG", "O'Hare", "Central", "203.0.113.42"]))
ROW = {"id": 28, "status": "SUCCESS", "ping_time": "2026-10-01T06:00:00.000000Z", **GEO}


class TransactionTests(unittest.TestCase):
    def database(self, existing=None):
        db = object.__new__(Db2)
        writer, reader = MagicMock(), MagicMock()
        contexts = []

        @contextlib.contextmanager
        def connection(readonly=False):
            contexts.append(readonly)
            con = reader if readonly else writer
            try:
                yield con
            finally:
                con.rollback()

        db.connection = connection
        db.lookup = MagicMock(side_effect=[existing, ROW])
        statement = MagicMock()
        statement.executeQuery.return_value.getLong.return_value = 28
        statement.executeUpdate.return_value = 1
        calls = []

        @contextlib.contextmanager
        def sql(con, text, args):
            calls.append((text, args))
            yield statement

        db.statement = sql
        return db, writer, contexts, calls

    def test_commit_then_verify_on_separate_read_connection(self):
        db, writer, contexts, calls = self.database()
        result = db.checkin(RID, GEO)
        writer.commit.assert_called_once()
        self.assertEqual(contexts, [False, True])
        self.assertTrue(result["committed"])
        self.assertNotIn("O'Hare", calls[0][0])
        self.assertIn("O'Hare", calls[0][1])

    def test_commit_failure_never_reports_success(self):
        db, writer, contexts, _ = self.database()
        writer.commit.side_effect = RuntimeError("commit failed")
        with self.assertRaises(RuntimeError):
            db.checkin(RID, GEO)
        writer.rollback.assert_called_once()
        self.assertEqual(contexts, [False])

    def test_repeated_request_does_not_insert(self):
        db, writer, _, calls = self.database(ROW)
        self.assertTrue(db.checkin(RID, GEO)["committed"])
        self.assertEqual(calls, [])
        writer.commit.assert_not_called()

    def test_conflicting_duplicate_is_rejected(self):
        db, _, _, calls = self.database(ROW)
        with self.assertRaises(Conflict):
            db.checkin(RID, {**GEO, "city": "changed"})
        self.assertEqual(calls, [])


class HttpTests(unittest.TestCase):
    def setUp(self):
        self.db = MagicMock()
        self.db.checkin.return_value = {"ok": True, "committed": True, "row": ROW}
        self.db.query.return_value = {"ok": True, "rows": [ROW], "count": 27}
        self.token = "test-bridge-authentication-token-32"
        self.server = make_server(self.db, self.token, 0)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def request(self, body=None, token=True, path="/v1/checkins"):
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = "Bearer " + self.token
        req = urllib.request.Request(f"http://127.0.0.1:{self.server.server_port}" + path,
            data=json.dumps(body).encode() if body is not None else None, headers=headers)
        try:
            with urllib.request.urlopen(req) as response:
                return response.status, json.load(response)
        except urllib.error.HTTPError as error:
            return error.code, json.load(error)

    def test_authentication_and_input_validation_precede_database_access(self):
        self.assertEqual(self.request(token=False)[0], 401)
        self.assertEqual(self.request({"request_id": RID, "sql": "DROP TABLE x"})[0], 400)
        self.assertEqual(self.request(path="/v1/checkins?page=-1")[0], 400)
        self.db.checkin.assert_not_called()
        self.db.query.assert_not_called()

    def test_valid_write_and_read(self):
        self.assertEqual(self.request({"request_id": RID, **GEO})[0], 201)
        self.db.checkin.assert_called_once_with(RID, GEO)
        self.assertEqual(self.request(path="/v1/checkins?page=2&limit=10")[0], 200)
        self.db.query.assert_called_once_with(2, 10)

    def test_failure_does_not_leak_credentials_or_claim_success(self):
        self.db.checkin.side_effect = RuntimeError("secret password")
        code, body = self.request({"request_id": RID, **GEO})
        self.assertEqual(code, 502)
        self.assertEqual(body, {"ok": False, "error": "database_error"})

    def test_unicode_limits_and_duplicate_query_parameters(self):
        with self.assertRaises(ValueError):
            checkin_payload({"request_id": RID, "colo": "界" * 6})
        with self.assertRaises(ValueError):
            pagination("page=1&page=2")


class MySQLHttpTests(unittest.TestCase):
    request = HttpTests.request
    tearDown = HttpTests.tearDown

    def setUp(self):
        HttpTests.setUp(self)
        self.mysql = MagicMock()
        self.mysql.checkin.return_value = {"ok": True, "committed": True, "row": ROW}
        self.mysql.query.return_value = {"ok": True, "rows": [ROW], "count": 1}
        self.mysql_token = "test-mysql-authentication-token-32"
        self.server.routes["/v1/mysql/checkins"] = (
            self.mysql, self.mysql_token, threading.BoundedSemaphore(4), "mysql")

    def test_mysql_route_requires_its_own_token(self):
        self.assertEqual(self.request(path="/v1/mysql/checkins")[0], 401)
        self.mysql.query.assert_not_called()
        self.token = self.mysql_token
        self.assertEqual(self.request(path="/v1/mysql/checkins?page=2&limit=10")[0], 200)
        self.mysql.query.assert_called_once_with(2, 10)
        self.db.query.assert_not_called()
        self.assertEqual(self.request({"request_id": RID, **GEO}, path="/v1/mysql/checkins")[0], 201)
        self.mysql.checkin.assert_called_once_with(RID, GEO)
        self.assertEqual(self.request(path="/v1/checkins")[0], 401)

    def test_mysql_busy_does_not_block_db2(self):
        slots = self.server.routes["/v1/mysql/checkins"][2]
        for _ in range(4):
            slots.acquire()
        self.assertEqual(self.request()[0], 200)
        self.token = self.mysql_token
        self.assertEqual(self.request(path="/v1/mysql/checkins")[0], 503)


if __name__ == "__main__":
    unittest.main()
