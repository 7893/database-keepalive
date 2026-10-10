package config

type Config struct {
	Env   map[string]string
	Model *Model
}

func (c Config) Get(key string) string { return c.Env[key] }
func (c Config) Missing(names []string) []string {
	var missing []string
	for _, name := range names {
		if c.Get(name) == "" {
			missing = append(missing, name)
		}
	}
	return missing
}
