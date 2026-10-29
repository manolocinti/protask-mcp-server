import express, { Express } from 'express';
type TokenVerifier = unknown;
export declare function createApp(opts?: {
    verifier?: TokenVerifier;
}): Express;
export declare const app: express.Express;
export {};
