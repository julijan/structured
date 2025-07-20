import { LooseObject } from './general.types.js';

export type SessionEntry = {
    sessionId: string;
    lastRequest: number;
    data: LooseObject;
};