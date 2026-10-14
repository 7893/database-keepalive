import { parse, TomlError } from 'smol-toml';
import { SafeError, validateConfig, type AppConfig } from '../src/config.ts';

export function parseLocalConfig(source: string): AppConfig {
  let value: unknown;
  try {
    value = parse(source);
  } catch (error) {
    // Parser messages and code blocks may contain credentials; report only location.
    const location = error instanceof TomlError ? ` at line ${error.line}, column ${error.column}` : '';
    throw new SafeError(`Invalid config.local.toml${location}. Check TOML syntax.`);
  }
  return validateConfig(value);
}
