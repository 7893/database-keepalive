import { SERVICE_DEFINITIONS } from './services.js';

export function missingEnv(env, names) {
  return names.filter(name => !env[name]);
}

export function serviceEnvNames(service) {
  return SERVICE_DEFINITIONS[service]?.required || [];
}

export function missingServiceEnv(env, service) {
  return missingEnv(env, serviceEnvNames(service));
}
