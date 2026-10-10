import { createHash } from 'node:crypto';
import { SERVICES } from '../config/services.js';
import { getDistinctRandomGeos } from './resolve.js';
import { seededInteger } from './random.js';

export function metadata(execution, service) {
  const hash = createHash('sha256').update(`${execution}:${service}`).digest();
  const hex = hash.toString('hex');
  const requestId = `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
  const index = SERVICES.indexOf(service);
  if (index < 0) throw new Error('invalid_service');
  const geos = getDistinctRandomGeos(SERVICES.length, seededInteger(execution));
  return { requestId, geo: geos[index] };
}
