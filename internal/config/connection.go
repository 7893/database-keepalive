package config

var suffixes = map[string][]string{
	"supabase": {"URL", "SECRET_KEY"},
	"adb":      {"URL", "USER", "PASS"},
	"db2":      {"HOST", "PORT", "DATABASE", "USER", "PASSWORD", "CA_FILE"},
	"mysql":    {"HOST", "PORT", "DATABASE", "USER", "PASSWORD", "SSL_CA"},
}
var mysqlOptional = []string{"CA_PEM", "SSL_VERIFY_IDENTITY"}
var tunnelSuffixes = []string{"HOSTNAME", "TOKEN_ID", "TOKEN_SECRET"}

func required(s Service) []string {
	names := []string{}
	for _, suffix := range suffixes[s.Type] {
		names = append(names, s.Prefix+"_"+suffix)
	}
	if s.TunnelPrefix != "" {
		for _, suffix := range tunnelSuffixes {
			names = append(names, s.TunnelPrefix+"_"+suffix)
		}
	}
	return names
}

// Adapters use canonical keys; instance credentials use the user's env prefix.
func (c Config) Connection(s Service) Config {
	env := map[string]string{}
	prefix := map[string]string{"supabase": "SUPABASE", "adb": "ADB", "db2": "DB2", "mysql": "MYSQL"}[s.Type]
	for _, suffix := range suffixes[s.Type] {
		env[prefix+"_"+suffix] = c.Get(s.Prefix + "_" + suffix)
	}
	if s.Type == "mysql" {
		for _, suffix := range mysqlOptional {
			env["MYSQL_"+suffix] = c.Get(s.Prefix + "_" + suffix)
		}
	}
	if s.TunnelPrefix != "" {
		for _, suffix := range tunnelSuffixes {
			env["TUNNEL_SERVICE_"+suffix] = c.Get(s.TunnelPrefix + "_" + suffix)
		}
	}
	return Config{Env: env, Model: c.Model}
}
