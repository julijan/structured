import { IncomingMessage, ServerResponse } from "node:http";
import { LooseObject } from "../Types.js";

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
    public set(response: ServerResponse, name: string, value: string|number, lifetimeSeconds: number, path: string = '/', sameSite: 'Strict' | 'Lax' | 'None' = 'Strict', domain?: string) {
        const expiresAt = lifetimeSeconds > 0 ? new Date(new Date().getTime() + lifetimeSeconds * 1000).toUTCString() : 0;
        response.appendHeader('Set-Cookie', `${name}=${value}; Expires=${expiresAt}; Path=${path}; SameSite=${sameSite}${domain ? `; domain=${domain}` : ''}`);
    }

}