import contextlib
import datetime
import os
import ssl
import types
import unittest
from unittest.mock import MagicMock, patch

from native.common import Conflict, GEO_FIELDS
from native.mysql import MySQL

RID = "e2e4bb5d-d57c-45ef-a4ba-50342a3cd099"
GEO = dict(zip(GEO_FIELDS, ["NRT", "JP", "O'Hare", "Kanto", "203.0.113.7"]))
ROW = {"id": 1, "status": "SUCCESS", "ping_time": "2026-10-10T01:23:00.000000Z", **GEO}


class IntegrityError(Exception):
    pass


class TransactionTests(unittest.TestCase):
    def database(self, existing=None, verified=ROW):
        db = object.__new__(MySQL)
        db.driver = types.SimpleNamespace(IntegrityError=IntegrityError)
        writer, reader, cur = MagicMock(), MagicMock(), MagicMock()
        writer.cursor.return_value.__enter__.return_value = cur
        cur.rowcount = 1
        contexts = []

        @contextlib.contextmanager
        def connection(readonly=False):
            contexts.append(readonly)
            con = reader if readonly else writer
            try:
                yield con
            finally:
                con.rollback()
                con.close()

        db.connection = connection
        db.lookup = MagicMock(side_effect=[existing, verified])
        return db, writer, cur, contexts

    def test_commit_and_independent_verification_with_bound_parameters(self):
        db, writer, cur, contexts = self.database()
        result = db.checkin(RID, GEO)
        self.assertTrue(result["committed"])
        writer.commit.assert_called_once()
        self.assertEqual(contexts, [False, True])
        sql, args = cur.execute.call_args.args
        self.assertNotIn("O'Hare", sql)
        self.assertIn("O'Hare", args)
        self.assertIn("UTC_TIMESTAMP(6)", sql)

    def test_commit_failure_never_reports_success(self):
        db, writer, _, contexts = self.database()
        writer.commit.side_effect = RuntimeError("commit failed")
        with self.assertRaises(RuntimeError):
            db.checkin(RID, GEO)
        self.assertEqual(contexts, [False])
        writer.rollback.assert_called_once()

    def test_missing_committed_row_is_failure(self):
        db, _, _, _ = self.database(verified=None)
        with self.assertRaisesRegex(RuntimeError, "commit_unconfirmed"):
            db.checkin(RID, GEO)

    def test_duplicate_does_not_insert_and_conflicting_payload_fails(self):
        db, writer, cur, _ = self.database(existing=ROW)
        self.assertTrue(db.checkin(RID, GEO)["committed"])
        cur.execute.assert_not_called()
        writer.commit.assert_not_called()
        db, _, _, _ = self.database(existing=ROW)
        with self.assertRaises(Conflict):
            db.checkin(RID, {**GEO, "city": "changed"})

    def test_racing_duplicate_verifies_winner_after_rollback(self):
        db, writer, cur, contexts = self.database()
        cur.execute.side_effect = IntegrityError(1062, "duplicate")
        self.assertTrue(db.checkin(RID, GEO)["committed"])
        writer.commit.assert_not_called()
        writer.rollback.assert_called_once()
        self.assertEqual(contexts, [False, True])

    def test_other_integrity_failure_propagates(self):
        db, _, cur, contexts = self.database()
        cur.execute.side_effect = IntegrityError(1048, "invalid value")
        with self.assertRaises(IntegrityError):
            db.checkin(RID, GEO)
        self.assertEqual(contexts, [False])

    def test_timestamps_are_utc_and_queries_use_bound_pagination(self):
        raw = {**ROW, "ping_time": datetime.datetime(2026, 10, 10, 1, 23)}
        self.assertEqual(MySQL.row(raw), ROW)
        db = object.__new__(MySQL)
        con, cur = MagicMock(), MagicMock()
        con.cursor.return_value.__enter__.return_value = cur
        cur.fetchone.return_value = {"cnt": 11}
        cur.fetchall.return_value = [raw]
        db.connection = MagicMock(return_value=contextlib.nullcontext(con))
        result = db.query(2, 10)
        self.assertEqual(result, {"ok": True, "rows": [ROW], "count": 11, "page": 2, "limit": 10})
        db.connection.assert_called_once_with(readonly=True)
        self.assertEqual(cur.execute.call_args.args[1], (10, 10))


class ConnectionTests(unittest.TestCase):
    def test_plaintext_fallback_is_rejected_and_connection_closed(self):
        db = object.__new__(MySQL)
        db.options = {}
        con, cur = MagicMock(), MagicMock()
        db.driver = types.SimpleNamespace(connect=MagicMock(return_value=con))
        con.cursor.return_value.__enter__.return_value = cur
        cur.fetchone.return_value = {"Value": ""}
        with self.assertRaisesRegex(RuntimeError, "mysql_tls_required"):
            with db.connection():
                self.fail("plaintext connection was accepted")
        con.rollback.assert_called_once()
        con.close.assert_called_once()

    def test_tls_verification_is_required_and_mysql_config_is_separate(self):
        module = types.SimpleNamespace(cursors=types.SimpleNamespace(DictCursor=object))
        values = {"MYSQL_HOST": "mysql.test", "MYSQL_USER": "test-user",
                  "MYSQL_PASSWORD": "test-password", "MYSQL_DATABASE": "keepalive"}
        with patch.dict(os.environ, values, clear=True), patch.dict("sys.modules", {"pymysql": module}):
            db = MySQL()
        self.assertEqual(db.options["ssl"].verify_mode, ssl.CERT_REQUIRED)
        self.assertTrue(db.options["ssl"].check_hostname)
        self.assertFalse(db.options["autocommit"])


    def test_legacy_ca_compatibility_preserves_required_verification(self):
        module = types.SimpleNamespace(cursors=types.SimpleNamespace(DictCursor=object))
        values = {"MYSQL_HOST": "mysql.test", "MYSQL_USER": "test-user",
                  "MYSQL_PASSWORD": "test-password", "MYSQL_DATABASE": "keepalive",
                  "MYSQL_SSL_STRICT": "false", "MYSQL_SSL_VERIFY_IDENTITY": "false"}
        with patch.dict(os.environ, values, clear=True), patch.dict("sys.modules", {"pymysql": module}):
            with self.assertRaisesRegex(ValueError, "mysql_legacy_ca_requires_explicit_trust"):
                MySQL()
            context = ssl.create_default_context()
            with patch.dict(os.environ, {"MYSQL_SSL_CA": "/test/pinned-ca.pem"}), \
                    patch("ssl.create_default_context", return_value=context):
                db = MySQL()
            self.assertEqual(db.options["ssl"].verify_mode, ssl.CERT_REQUIRED)
            self.assertFalse(db.options["ssl"].verify_flags & ssl.VERIFY_X509_STRICT)
            self.assertFalse(db.options["ssl"].check_hostname)
            with patch.dict(os.environ, {"MYSQL_SSL_STRICT": "invalid"}):
                with self.assertRaisesRegex(ValueError, "invalid_mysql_tls_strict_setting"):
                    MySQL()




if __name__ == "__main__":
    unittest.main()
