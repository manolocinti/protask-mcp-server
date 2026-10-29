import type { NextFunction, Request, Response } from 'express';
export type VerifyResult = 'ok' | 'invalid' | 'unavailable' | {
    rejected: number;
} | {
    retryAfter: number;
};
export interface TokenVerifier {
    verify(token: string, ip?: string): Promise<VerifyResult>;
    forget(token: string): void;
}
export declare function wwwAuthenticate(invalidToken: boolean): string;
export declare function extractToken(req: Request): string | null;
export declare function createTokenVerifier({ apiUrl, ttlMs, max, timeoutMs, maxInvalid, invalidWindowMs, maxIps }: {
    apiUrl: string;
    ttlMs?: number;
    max?: number;
    timeoutMs?: number;
    maxInvalid?: number;
    invalidWindowMs?: number;
    maxIps?: number;
}): TokenVerifier;
export declare function sendUnauthorized(res: Response, opts: {
    invalidToken: boolean;
    jsonRpc?: boolean;
    id?: unknown;
}): void;
export declare function sendVerifyFailure(res: Response, result: Exclude<VerifyResult, 'ok' | 'invalid'>, id?: unknown): void;
export declare function requireToken(verifier: TokenVerifier, { jsonRpc }?: {
    jsonRpc?: boolean;
}): (req: Request, res: Response, next: NextFunction) => Promise<void>;
