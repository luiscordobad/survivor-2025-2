import { DateTime } from 'luxon';
export const tz = process.env.TIMEZONE || 'America/Mexico_City';
export const nowMx = () => DateTime.now().setZone(tz);
export const toUtc = (dt) => DateTime.fromISO(dt, { zone: tz }).toUTC();
