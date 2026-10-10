"""TLS-verified native Db2 storage with commit verification and idempotency."""
from contextlib import contextmanager
import datetime
import os

FIELDS = ("id", "ping_time", "status", "colo", "country", "city", "region", "ip")
GEO_FIELDS = FIELDS[3:]
LOGS = "DB2_KEEPALIVE_LOGS"
REQUESTS = "DB2_KEEPALIVE_REQUESTS"


class Conflict(Exception):
    pass


class Db2:
    def __init__(self):
        import jpype
        self.java = jpype
        if not jpype.isJVMStarted():
            jpype.startJVM("-Xmx128m", "-XX:-UsePerfData",
                          "--enable-native-access=ALL-UNNAMED",
                          "-Duser.timezone=UTC", classpath=[os.environ["DB2_JDBC_JAR"]],
                          convertStrings=True)
        self.driver = jpype.JClass("com.ibm.db2.jcc.DB2Driver")()
        self.properties = jpype.JClass("java.util.Properties")()
        values = {
            "user": os.environ["DB2_USER"], "password": os.environ["DB2_PASSWORD"],
            "sslConnection": "true", "sslClientHostnameValidation": "BASIC",
            "sslCertLocation": os.environ["DB2_CA_FILE"],
            "loginTimeout": "5", "blockingReadConnectionTimeout": "8",
        }
        for name, value in values.items():
            self.properties.setProperty(name, value)
        self.url = (f"jdbc:db2://{os.environ['DB2_HOST']}:{int(os.environ['DB2_PORT'])}"
                    f"/{os.environ['DB2_DATABASE']}")

    @contextmanager
    def connection(self, readonly=False):
        con = self.driver.connect(self.url, self.properties)
        try:
            con.setAutoCommit(False)
            con.setReadOnly(readonly)
            yield con
        finally:
            try:
                con.rollback()
            finally:
                con.close()

    @contextmanager
    def statement(self, con, sql, args=()):
        stmt = con.prepareStatement(sql)
        try:
            stmt.setQueryTimeout(8)
            for index, value in enumerate(args, 1):
                if value is None:
                    stmt.setNull(index, self.java.JClass("java.sql.Types").VARCHAR)
                elif isinstance(value, int):
                    stmt.setLong(index, value)
                else:
                    stmt.setString(index, value)
            yield stmt
        finally:
            stmt.close()

    def rows(self, con, sql, args=()):
        with self.statement(con, sql, args) as stmt:
            result = stmt.executeQuery()
            try:
                rows = []
                while result.next():
                    row = {"id": int(result.getLong(1))}
                    stamp = str(result.getTimestamp(2).toLocalDateTime())
                    row["ping_time"] = datetime.datetime.fromisoformat(stamp).isoformat(
                        timespec="microseconds") + "Z"
                    row.update({field: result.getString(i)
                                for i, field in enumerate(FIELDS[2:], 3)})
                    rows.append(row)
                return rows
            finally:
                result.close()

    def lookup(self, con, request_id):
        fields = ",".join("l." + f for f in FIELDS)
        rows = self.rows(con, f"SELECT {fields} FROM {LOGS} l JOIN {REQUESTS} r "
                         "ON l.ID=r.LOG_ID WHERE r.REQUEST_ID=?", [request_id])
        return rows[0] if rows else None

    def checkin(self, request_id, geo):
        try:
            with self.connection() as con:
                existing = self.lookup(con, request_id)
                if existing is None:
                    with self.statement(con,
                        f"SELECT ID FROM FINAL TABLE (INSERT INTO {LOGS} "
                        "(PING_TIME,STATUS,COLO,COUNTRY,CITY,REGION,IP) VALUES "
                        "(CURRENT TIMESTAMP - CURRENT TIMEZONE,'SUCCESS',?,?,?,?,?))",
                        [geo.get(f) for f in GEO_FIELDS]) as stmt:
                        result = stmt.executeQuery()
                        try:
                            if not result.next():
                                raise RuntimeError("insert_unconfirmed")
                            row_id = int(result.getLong(1))
                        finally:
                            result.close()
                    with self.statement(con,
                        f"INSERT INTO {REQUESTS} (REQUEST_ID,LOG_ID) VALUES (?,?)",
                        [request_id, row_id]) as stmt:
                        if stmt.executeUpdate() != 1:
                            raise RuntimeError("request_unconfirmed")
                    con.commit()
        except Exception as error:
            # Concurrent duplicate requests roll back the losing log insert.
            if not hasattr(error, "getSQLState") or str(error.getSQLState()) != "23505":
                raise
        with self.connection(readonly=True) as con:
            row = self.lookup(con, request_id)
            if not row or row["status"] != "SUCCESS":
                raise RuntimeError("commit_unconfirmed")
            if any(row[f] != geo.get(f) for f in GEO_FIELDS):
                raise Conflict("request_id_reused")
            return {"ok": True, "committed": True, "request_id": request_id, "row": row}

    def query(self, page, limit):
        with self.connection(readonly=True) as con:
            con.setTransactionIsolation(8)  # JDBC TRANSACTION_SERIALIZABLE
            with self.statement(con, f"SELECT COUNT(*) FROM {LOGS}") as stmt:
                result = stmt.executeQuery()
                try:
                    result.next()
                    count = int(result.getLong(1))
                finally:
                    result.close()
            rows = self.rows(con, f"SELECT {','.join(FIELDS)} FROM {LOGS} "
                             "ORDER BY PING_TIME DESC, ID DESC OFFSET ? ROWS "
                             "FETCH NEXT ? ROWS ONLY", [(page - 1) * limit, limit])
            return {"ok": True, "rows": rows, "count": count, "page": page, "limit": limit}
