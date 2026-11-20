import type { ProTaskClient } from './api-client.js';
/** Il validator di ProTask accetta file fino a 20480 KB: oltre è inutile caricarli in memoria. */
export declare const MAX_ATTACHMENT_BYTES: number;
export interface FilePayload {
    data: Uint8Array;
    name: string;
    type: string;
}
export declare function mimeFromName(name: string): string;
/** Nome di file pulito: niente cartelle, caratteri di controllo o nomi vuoti. */
export declare function safeFileName(raw: string): string;
export declare function loadLocalFile(rawPath: string): Promise<FilePayload>;
/** true se l'indirizzo è raggiungibile su Internet (non loopback, rete privata, link-local, riservato...). */
export declare function isPublicAddress(ip: string): boolean;
type AddressCheck = (ip: string) => boolean;
/** `allowed` sostituisce il controllo degli indirizzi solo nei test (server locale su 127.0.0.1). */
export declare function downloadFile(rawUrl: string, opts?: {
    allowed?: AddressCheck;
}): Promise<FilePayload>;
export declare const UPLOAD_LINK_TTL_MS: number;
export declare const UPLOAD_LINK_MAX_FILES = 10;
export interface UploadLink {
    client: ProTaskClient;
    taskId: number;
    taskTitle: string;
    expiresAt: number;
    uploaded: number;
}
export declare class UploadLinkStore {
    private now;
    private links;
    constructor(now?: () => number);
    private sweep;
    create(client: ProTaskClient, taskId: number, taskTitle: string): {
        code: string;
        expiresAt: number;
    };
    /** Il link se esiste, non è scaduto e ha ancora caricamenti a disposizione. */
    get(code: string): UploadLink | undefined;
    revoke(code: string): void;
}
export declare function uploadPageHeaders(nonce: string): Record<string, string>;
export declare function renderUploadPage(opts: {
    taskTitle: string;
    expiresAt: number;
    nonce: string;
}): string;
export declare function renderExpiredPage(nonce: string): string;
/** Nome e tipo mandati dalla pagina di caricamento, ripuliti. */
export declare function payloadFromUpload(body: Buffer, rawName: unknown, rawType: unknown): FilePayload;
export {};
