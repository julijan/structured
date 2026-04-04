import { IncomingMessage, ServerResponse } from "node:http";
import { LooseObject } from '../types/general.types.js';

export class Cookies {

    // parse cookies sent with given request into an object
    public parse(request: IncomingMessage): LooseObject {
        if (! request.headers.cookie) {return {};}
        const cookieString = request.headers.cookie;
        const cookiePairs = cookieString.split(';');

        const cookies: LooseObject = {}

        cookiePairs.forEach((cookiePair) => {
            const parts = cookiePair.trim().split('=');
            cookies[parts.shift() || ''] = parts.join('=');
        });

        return cookies;
    }

    // set a cookie for given response
    // sets the Set-Cookie header, which will be sent with the output
    public set(
        response: ServerResponse,
        name: string,
        value: string|number,
        lifetimeSeconds: number,
        path: string = '/',
        sameSite: 'Strict' | 'Lax' | 'None' = 'Strict',
        domain: string | null = null,
        secure: boolean = false
    ): void {
        const expiresAt = lifetimeSeconds > 0 ? new Date(new Date().getTime() + lifetimeSeconds * 1000).toUTCString() : 0;

        const parts: Array<string> = [];
        parts.push(`${name}=${value}`);
        parts.push(`Expires=${expiresAt}`);
        parts.push(`Path=${path}`);
        parts.push(`SameSite=${sameSite}`);

        if (typeof domain === 'string') {
            parts.push(`domain=${domain}`);
        }

        if (secure) {
            parts.push('Secure=true');
        }

        response.appendHeader('Set-Cookie', parts.join('; '));
    }

}