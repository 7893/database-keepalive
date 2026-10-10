import { isIP } from 'node:net';
import { SERVICES } from '../src/config.js';
import { missingEnv, serviceEnvNames } from '../src/env.js';

export function runtimeConfig(input) {
  const env = { ...input };
  const required = [
    'TRIGGER_SECRET', 'PUBLIC_ORIGIN', 'SCHEDULER_TOKEN', 'MYSQL_CA_PEM',
    'TUNNEL_SERVICE_HOSTNAME', 'TUNNEL_SERVICE_TOKEN_ID', 'TUNNEL_SERVICE_TOKEN_SECRET',
    ...SERVICES.flatMap(serviceEnvNames)
  ];
  const missing = [...new Set(missingEnv(env, required))];
  if (missing.length) throw new Error('Missing configuration: ' + missing.join(', '));
  const port = Number(env.MYSQL_PORT);
  if (!/^\d+$/.test(env.MYSQL_PORT) || !Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('Invalid configuration: MYSQL_PORT');
  return env;
}

export function tunnelAddress(env) {
  const host = isIP(env.MYSQL_HOST) === 6 ? `[${env.MYSQL_HOST}]` : env.MYSQL_HOST;
  return `${host}:${env.MYSQL_PORT}`;
}
