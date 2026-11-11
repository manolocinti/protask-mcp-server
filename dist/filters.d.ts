/** Argomento di un tool non valido: diventa un errore del tool, non un errore del protocollo. */
export declare class ToolInputError extends Error {
    constructor(message: string);
}
export declare const PRIORITY_WORD_LIST: string[];
/** Priorità come intero 0-4: accetta il numero, la stringa del numero o la parola (it/en, maiuscole ignorate). */
export declare function parsePriority(value: unknown): number;
/** Filtro priorità: interi separati da virgola ("3,4"), o undefined se vuoto. */
export declare function parsePriorityFilter(value: unknown): string | undefined;
export declare const DUE_VALUES: string[];
/** Filtro scadenza: valori di DUE_VALUES separati da virgola, o undefined se vuoto. Un null JSON vale "null". */
export declare function parseDueFilter(value: unknown): string | undefined;
/** Data YYYY-MM-DD (esistente), o undefined se assente. */
export declare function parseDate(name: string, value: unknown): string | undefined;
export type TaskFilters = {
    priority?: string;
    due?: string;
    due_from?: string;
    due_to?: string;
};
/** Filtri comuni a protask_list_tasks e protask_my_tasks, già nella forma della query string. */
export declare function parseTaskFilters(args: Record<string, unknown>): TaskFilters;
/** Oggetto semplice (non array, non null). Una stringa JSON di un oggetto viene letta. */
export declare function parseObject(name: string, value: unknown): Record<string, unknown>;
