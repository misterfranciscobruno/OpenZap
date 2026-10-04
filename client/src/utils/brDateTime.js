/** Fuso horário de Brasília / São Paulo (sem horário de verão desde 2019). */
export const BR_TZ = 'America/Sao_Paulo';

function ymdInTz(date, tz = BR_TZ) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/**
 * Interpreta datas gravadas pelo servidor (SQLite `datetime('now')` em UTC)
 * ou ISO com timezone.
 */
export function parseServerDate(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim();
  if (!s) return null;
  const isoLike = s.includes('T') ? s : s.replace(' ', 'T');
  const withZone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(isoLike) ? isoLike : `${isoLike}Z`;
  const d = new Date(withZone);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatTimeBrFromRaw(raw) {
  const d = parseServerDate(raw);
  if (!d) return '';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: BR_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

export function formatTimeBr(d) {
  if (!d || Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: BR_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

export function formatLastSeenBr(raw) {
  const d = parseServerDate(raw);
  if (!d) return '';
  const todayYmd = ymdInTz(new Date(), BR_TZ);
  const msgYmd = ymdInTz(d, BR_TZ);
  const t = formatTimeBr(d);
  if (msgYmd === todayYmd) return `visto hoje às ${t}`;
  const yest = new Date(Date.now() - 86400000);
  if (msgYmd === ymdInTz(yest, BR_TZ)) return `visto ontem às ${t}`;
  const dateStr = new Intl.DateTimeFormat('pt-BR', {
    timeZone: BR_TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d);
  return `visto em ${dateStr} às ${t}`;
}

export function dayKeyBr(raw) {
  const d = parseServerDate(raw);
  if (!d) return 'invalid';
  return ymdInTz(d, BR_TZ);
}

export function dateLabelBr(raw) {
  const d = parseServerDate(raw);
  if (!d) return '';
  if (ymdInTz(d, BR_TZ) === ymdInTz(new Date(), BR_TZ)) return 'Hoje';
  const yest = new Date(Date.now() - 86400000);
  if (ymdInTz(d, BR_TZ) === ymdInTz(yest, BR_TZ)) return 'Ontem';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: BR_TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d);
}

/** Hora ou data curta para a lista lateral (estilo WhatsApp). */
export function formatSidebarListTime(d) {
  if (!d || Number.isNaN(d.getTime())) return '';
  const todayYmd = ymdInTz(new Date(), BR_TZ);
  const msgYmd = ymdInTz(d, BR_TZ);
  const t = formatTimeBr(d);
  if (msgYmd === todayYmd) return t;
  const yest = new Date(Date.now() - 86400000);
  if (msgYmd === ymdInTz(yest, BR_TZ)) return 'ontem';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: BR_TZ,
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  }).format(d);
}
