import { CONFIG_TIMEZONES } from './rig-config-timezones.js';
/** Presentation only. QuickJS has no Intl; never apply today's offset to older instants. */
export function timezoneValue(response) {
  return typeof response?.value === 'string' && response.value.trim() ? response.value.trim() : null;
}
const utc=zone=>zone==='UTC'||zone==='Etc/UTC';
const pad=n=>String(n).padStart(2,'0');
export function localOffsetLabel(stamp=new Date()) {
  const offset=-stamp.getTimezoneOffset();
  return offset===0?'UTC':`UTC${offset<0?'−':'+'}${pad(Math.floor(Math.abs(offset)/60))}:${pad(Math.abs(offset)%60)}`;
}
export function timezoneNote(zone,now=Date.now()) {
  if(!zone||utc(zone))return null;
  // The canonical list omits some valid aliases; never call an unlisted name invalid.
  if(!/^[A-Za-z0-9_+-]+(?:\/[A-Za-z0-9_+-]+)*$/.test(zone))return `ui.timezone "${zone}" isn't a valid time zone, so times show in this computer's zone.`;
  if(!CONFIG_TIMEZONES.has(zone))return `Herdr can't validate or show times in ${zone} here, so times show in this computer's zone (${localOffsetLabel(new Date(now))}).`;
  return `Herdr can't show times in ${zone} yet, so times show in this computer's zone (${localOffsetLabel(new Date(now))}).`;
}
export function formatAbsoluteTime(value,{timezone=null,date=false,seconds=false,exact=false}={}) {
  if(value===null||value===undefined||value==='')return '—';
  const stamp=new Date(value);if(!Number.isFinite(stamp.getTime()))return String(value);
  const useUtc=utc(timezone),get=part=>stamp[`${useUtc?'getUTC':'get'}${part}`]();
  const day=date||exact?`${exact?get('FullYear')+'-':''}${pad(get('Month')+1)}-${pad(get('Date'))} `:'';
  const suffix=exact?(useUtc?'UTC':localOffsetLabel(stamp)):useUtc&&stamp.getTimezoneOffset()!==0?'UTC':'';
  return `${day}${pad(get('Hours'))}:${pad(get('Minutes'))}${seconds||exact?':'+pad(get('Seconds')):''}${suffix?' '+suffix:''}`;
}
