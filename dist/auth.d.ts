import type { NextFunction, Request, Response } from 'express';
export type VerifyResult = 'ok' | 'invalid' | 'unavailable' | {
    rejected: number;
};
export interface TokenVerifier {
    verify(token: string): Promise<VerifyResult>;
    forget(token: string): void;
}
export declare function wwwAuthenticate(invalidToken: boolean): string;
export declare function extractToken(req: Request): string | null;
export declare function createTokenVerifier({ apiUrl, ttlMs, max, timeoutMs }: {
    apiUrl: string;
    ttlMs?: number;
    max?: number;
    timeoutMs?: number;
}): TokenVerifier;
export declare function sendUnauthorized(res: Response, opts: {
    invalidToken: boolean;
    jsonRpc?: boolean;
    id?: unknown;
}): void;
export declare function sendVerifyFailure(res: Response, result: 'unavailable' | {
    rejected: number;
}, id?: unknown): void;
export declare function requireToken(verifier: TokenVerifier, { jsonRpc }?: {
    jsonRpc?: boolean;
}): (req: Request, res: Response, next: NextFunction) => Promise<void>;
