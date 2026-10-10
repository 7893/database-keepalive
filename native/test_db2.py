import contextlib
import unittest
from unittest.mock import MagicMock

from db2 import Conflict, Db2, GEO_FIELDS

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
