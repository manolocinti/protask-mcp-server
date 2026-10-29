import express, { Express } from 'express';
import { type TokenVerifier } from './auth.js';
export declare function createApp(opts?: {
    verifier?: TokenVerifier;
}): Express;
export declare const app: express.Express;
