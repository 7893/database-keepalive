export function missingEnv(env, names) {
  return names.filter(name => !env[name]);
}

export function serviceEnvNames(service, operation = "ping") {
  if (service === "supabase") return ["SUPABASE_URL", "SUPABASE_SECRET_KEY"];
  if (service === "adb_us") return ["OCI_ADB_US_URL", "OCI_ADB_US_USER", "OCI_ADB_US_PASS"];
  if (service === "adb_jp") return ["OCI_ADB_JP_URL", "OCI_ADB_JP_USER", "OCI_ADB_JP_PASS"];
  if (service === "db2") return ["DB2_BRIDGE_URL", "DB2_BRIDGE_TOKEN"];
  if (service === "mysql_jp") return ["MYSQL_JP_BRIDGE_URL", "MYSQL_JP_BRIDGE_TOKEN"];
  return [];
}

export function missingServiceEnv(env, service, operation = "ping") {
  if (typeof env.backends?.[service]?.[operation] === "function") return [];
  return missingEnv(env, serviceEnvNames(service, operation));
}
