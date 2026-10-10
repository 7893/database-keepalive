export const SERVICE_DEFINITIONS = {
  supabase: {
    title: "Supabase", adapter: "supabase", displayOrder: 0, pageAlias: "sb_p",
    required: ["SUPABASE_URL", "SUPABASE_SECRET_KEY"]
  },
  adb_us: {
    title: "Oracle ADB · United States", adapter: "oracle", displayOrder: 2, pageAlias: "us_p",
    required: ["OCI_ADB_US_URL", "OCI_ADB_US_USER", "OCI_ADB_US_PASS"]
  },
  adb_jp: {
    title: "Oracle ADB · Japan", adapter: "oracle", displayOrder: 4, pageAlias: "jp_p",
    required: ["OCI_ADB_JP_URL", "OCI_ADB_JP_USER", "OCI_ADB_JP_PASS"]
  },
  db2: {
    title: "IBM Db2", adapter: "native", displayOrder: 1, pageAlias: "db2_p",
    required: ["DB2_HOST", "DB2_PORT", "DB2_DATABASE", "DB2_USER", "DB2_PASSWORD", "DB2_JDBC_JAR", "DB2_CA_FILE"]
  },
  mysql_jp: {
    title: "MySQL · Japan", adapter: "native", displayOrder: 3, pageAlias: "mysql_jp_p",
    required: ["MYSQL_HOST", "MYSQL_PORT", "MYSQL_DATABASE", "MYSQL_USER", "MYSQL_PASSWORD", "MYSQL_SSL_CA"]
  }
};
export const SERVICES = Object.keys(SERVICE_DEFINITIONS);
export const DISPLAY_SERVICES = [...SERVICES].sort((a, b) =>
  SERVICE_DEFINITIONS[a].displayOrder - SERVICE_DEFINITIONS[b].displayOrder);
export const SERVICE_SET = new Set(SERVICES);
