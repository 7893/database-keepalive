import { createHash } from 'node:crypto';
import { GLOBAL_POPS } from './config.js';

export function metadata(execution, service) {
  const hash = createHash('sha256').update(`${execution}:${service}`).digest();
  const hex = hash.toString('hex');
  const requestId = `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
  const pop = GLOBAL_POPS[hash.readUInt32BE(0) % GLOBAL_POPS.length];
  const subnet = pop.subnets?.[hash[4] % pop.subnets.length] || '104.28.0';
  return { requestId, geo: { colo: pop.colo, country: pop.country,
    city: pop.city, region: pop.region, ip: `${subnet}.${2 + hash[5] % 252}` } };
}
