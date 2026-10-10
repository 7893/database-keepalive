"""MySQL checkins with TLS, idempotent inserts and independent commit verification."""
from contextlib import contextmanager
import datetime
import os
import ssl

from db import Conflict, FIELDS, GEO_FIELDS


class MySQL:
    def __init__(self):
        import pymysql
        self.driver = pymysql
        tls = ssl.create_default_context(cafile=os.environ.get("MYSQL_SSL_CA") or None)
        # Explicit CA-only verification is available for private-IP endpoints.
        identity = os.environ.get("MYSQL_SSL_VERIFY_IDENTITY", "true")
        if identity not in {"true", "false"}:
            raise ValueError("invalid_mysql_tls_identity_setting")
        tls.check_hostname = identity == "true"
        strict = os.environ.get("MYSQL_SSL_STRICT", "true")
        if strict not in {"true", "false"}:
            raise ValueError("invalid_mysql_tls_strict_setting")
        if strict == "false":
            # OCI service-defined CAs may omit KeyUsage. Still verify the chain
            # against an explicitly pinned CA; never permit unverified TLS.
            if not os.environ.get("MYSQL_SSL_CA"):
                raise ValueError("mysql_legacy_ca_requires_explicit_trust")
            tls.verify_flags &= ~ssl.VERIFY_X509_STRICT
        self.options = {
            "host": os.environ["MYSQL_HOST"],
            "port": int(os.environ.get("MYSQL_PORT", "3306")),
            "user": os.environ["MYSQL_USER"],
            "password": os.environ["MYSQL_PASSWORD"],
            "database": os.environ["MYSQL_DATABASE"],
            "charset": "utf8mb4", "autocommit": False,
            "connect_timeout": 5, "read_timeout": 8, "write_timeout": 8,
            "cursorclass": pymysql.cursors.DictCursor, "ssl": tls,
        }

    @contextmanager
    def connection(self, readonly=False):
        con = self.driver.connect(**self.options)
        try:
            with con.cursor() as cur:
                cur.execute("SHOW SESSION STATUS LIKE 'Ssl_cipher'")
                if not (cur.fetchone() or {}).get("Value"):
                    raise RuntimeError("mysql_tls_required")
                cur.execute("SET SESSION innodb_lock_wait_timeout=5")
                cur.execute("SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ")
                cur.execute("START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY"
                            if readonly else "START TRANSACTION")
            yield con
        finally:
            try:
                con.rollback()
            finally:
                con.close()

    @staticmethod
    def row(value):
        if value is None:
            return None
        result = dict(value)
        stamp = result["ping_time"]
        if not isinstance(stamp, datetime.datetime):
            raise RuntimeError("invalid_database_timestamp")
        result["ping_time"] = stamp.replace(tzinfo=datetime.timezone.utc).isoformat(
            timespec="microseconds").replace("+00:00", "Z")
        return result

    def lookup(self, con, request_id):
        with con.cursor() as cur:
            cur.execute(f"SELECT {','.join(FIELDS)} FROM keepalive_logs WHERE request_id=%s",
                        (request_id,))
            return self.row(cur.fetchone())

    def checkin(self, request_id, geo):
        try:
            with self.connection() as con:
                existing = self.lookup(con, request_id)
                if existing is None:
                    with con.cursor() as cur:
                        cur.execute(
                            "INSERT INTO keepalive_logs "
                            "(request_id,ping_time,status,colo,country,city,region,ip) "
                            "VALUES (%s,UTC_TIMESTAMP(6),'SUCCESS',%s,%s,%s,%s,%s)",
                            (request_id, *(geo.get(f) for f in GEO_FIELDS)))
                        if cur.rowcount != 1:
                            raise RuntimeError("insert_unconfirmed")
                    con.commit()
        except self.driver.IntegrityError as error:
            # A racing duplicate rolls back, then verifies the winning transaction.
            if error.args[0] != 1062:
                raise
        with self.connection(readonly=True) as con:
            row = self.lookup(con, request_id)
            if not row or row["status"] != "SUCCESS":
                raise RuntimeError("commit_unconfirmed")
            if any(row[f] != geo.get(f) for f in GEO_FIELDS):
                raise Conflict("request_id_reused")
            return {"ok": True, "committed": True, "request_id": request_id, "row": row}

    def query(self, page, limit):
        with self.connection(readonly=True) as con, con.cursor() as cur:
            cur.execute("SELECT COUNT(*) AS cnt FROM keepalive_logs")
            count = int(cur.fetchone()["cnt"])
            cur.execute(f"SELECT {','.join(FIELDS)} FROM keepalive_logs "
                        "ORDER BY ping_time DESC,id DESC LIMIT %s OFFSET %s",
                        (limit, (page - 1) * limit))
            rows = [self.row(value) for value in cur.fetchall()]
            return {"ok": True, "rows": rows, "count": count, "page": page, "limit": limit}
