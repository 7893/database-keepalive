export function missingEnv(env, names) {
  return names.filter(name => !env[name]);
}

export function serviceEnvNames(service, operation = "ping") {
  if (service === "supabase") return ["SUPABASE_URL", "SUPABASE_SECRET_KEY"];
  if (service === "adb_us") return ["OCI_ADB_US_URL", "OCI_ADB_US_USER", "OCI_ADB_US_PASS"];
  if (service === "adb_jp") return ["OCI_ADB_JP_URL", "OCI_ADB_JP_USER", "OCI_ADB_JP_PASS"];
  if (service === "db2") return ["DB2_HOST", "DB2_PORT", "DB2_DATABASE", "DB2_USER", "DB2_PASSWORD", "DB2_JDBC_JAR", "DB2_CA_FILE"];
  if (service === "mysql_jp") return ["MYSQL_HOST", "MYSQL_PORT", "MYSQL_DATABASE", "MYSQL_USER", "MYSQL_PASSWORD", "MYSQL_SSL_CA"];
  return [];
}

export function missingServiceEnv(env, service, operation = "ping") {
  if (typeof env.backends?.[service]?.[operation] === "function") return [];
  return missingEnv(env, serviceEnvNames(service, operation));
}
