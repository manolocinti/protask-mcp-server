// Conversione e controllo degli argomenti dei tool prima di mandarli all'API:
// priorità (numero o parola), filtri di scadenza, date. Un valore non valido lancia ToolInputError,
// che executeTool trasforma in un risultato con isError (il modello legge il messaggio e corregge).

/** Argomento di un tool non valido: diventa un errore del tool, non un errore del protocollo. */
export class ToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolInputError';
  }
}

// 0 nessuna, 1 bassa, 2 media, 3 alta, 4 urgente
const PRIORITY_WORDS: Record<string, number> = {
  nessuna: 0, none: 0,
  bassa: 1, low: 1,
  media: 2, medium: 2,
  alta: 3, high: 3,
  urgente: 4, urgent: 4,
};

export const PRIORITY_WORD_LIST = ['nessuna', 'bassa', 'media', 'alta', 'urgente', 'none', 'low', 'medium', 'high', 'urgent'];

const PRIORITY_HELP = 'valori ammessi: 0-4 oppure nessuna/bassa/media/alta/urgente (none/low/medium/high/urgent)';

/** Priorità come intero 0-4: accetta il numero, la stringa del numero o la parola (it/en, maiuscole ignorate). */
export function parsePriority(value: unknown): number {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 4) return value;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (/^[0-4]$/.test(v)) return Number(v);
    if (v in PRIORITY_WORDS) return PRIORITY_WORDS[v];
  }
  throw new ToolInputError(`priorità non valida: ${JSON.stringify(value)}; ${PRIORITY_HELP}`);
}

// Un filtro a più valori arriva come array, come stringa separata da virgole o come valore singolo
function splitValues(value: unknown): unknown[] {
  const items = Array.isArray(value) ? value : [value];
  const out: unknown[] = [];
  for (const item of items) {
    if (typeof item === 'string') {
      for (const part of item.split(',')) if (part.trim() !== '') out.push(part.trim());
    } else {
      out.push(item);
    }
  }
  return out;
}

const unique = <T>(values: T[]): T[] => [...new Set(values)];

/** Filtro priorità: interi separati da virgola ("3,4"), o undefined se vuoto. */
export function parsePriorityFilter(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const ints = unique(splitValues(value).map(parsePriority));
  return ints.length ? ints.join(',') : undefined;
}

export const DUE_VALUES = ['over', 'next_day', 'next_week', 'next_month', 'null'];

/** Filtro scadenza: valori di DUE_VALUES separati da virgola, o undefined se vuoto. Un null JSON vale "null". */
export function parseDueFilter(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const items = Array.isArray(value) ? value.map((v) => (v === null ? 'null' : v)) : value;
  const out = splitValues(items).map((v) => {
    const s = typeof v === 'string' ? v.trim().toLowerCase() : v;
    if (typeof s === 'string' && DUE_VALUES.includes(s)) return s;
    throw new ToolInputError(`valore di due non valido: ${JSON.stringify(v)}; valori ammessi: ${DUE_VALUES.join(', ')}`);
  });
  const vals = unique(out as string[]);
  return vals.length ? vals.join(',') : undefined;
}

/** Data YYYY-MM-DD (esistente), o undefined se assente. */
export function parseDate(name: string, value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    const v = value.trim();
    const d = new Date(`${v}T00:00:00Z`);
    if (!Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v) return v;
  }
  throw new ToolInputError(`${name} non valida: ${JSON.stringify(value)}; formato atteso YYYY-MM-DD`);
}

export type TaskFilters = { priority?: string; due?: string; due_from?: string; due_to?: string };

/** Filtri comuni a protask_list_tasks e protask_my_tasks, già nella forma della query string. */
export function parseTaskFilters(args: Record<string, unknown>): TaskFilters {
  const filters: TaskFilters = {};
  const priority = parsePriorityFilter(args.priority);
  const due = parseDueFilter(args.due);
  const dueFrom = parseDate('due_from', args.due_from);
  const dueTo = parseDate('due_to', args.due_to);
  if (priority !== undefined) filters.priority = priority;
  if (due !== undefined) filters.due = due;
  if (dueFrom !== undefined) filters.due_from = dueFrom;
  if (dueTo !== undefined) filters.due_to = dueTo;
  return filters;
}

/** Oggetto semplice (non array, non null). Una stringa JSON di un oggetto viene letta. */
export function parseObject(name: string, value: unknown): Record<string, unknown> {
  let v = value;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch { /* resta stringa: errore sotto */ }
  }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    throw new ToolInputError(`${name} deve essere un oggetto, per esempio {"budget": 1200, "canale": "email"}`);
  }
  return v as Record<string, unknown>;
}
