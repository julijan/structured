import conf from '../../app/Config.js';
import { LooseObject, RequestContext, SessionEntry } from '../Types.js';
import { Application } from './Application.js';

export class Session {

    application: Application;
    enabled: boolean = false;

    sessions: {
        [key: string] : SessionEntry
    } = {};

    constructor(app: Application) {
        this.application = app;

        // bind the event listener to beforeRequestHandler
        this.application.on('beforeRequestHandler', async (ctx) => {
            if (this.enabled) {
                let sessionCookie = ctx.cookies[conf.session.cookieName];

                let invalidSessionId = sessionCookie && ! this.sessions[sessionCookie];

                if (! sessionCookie || invalidSessionId) {
                    // user has no started session, initialize session
                    this.sessionInit(ctx);
                } else {
                    ctx.sessionId = sessionCookie;
                    if (ctx.sessionId) {
                        // refresh cookie
                        this.application.setCookie(ctx.response, conf.session.cookieName, ctx.sessionId, conf.session.durationSeconds);
                    }
                }
            }
        });

        // start garbage collecting
        this.garbageCollect();
    }

    public start(): void {
        this.enabled = true;
    }

    public stop(): void {
        this.enabled = false;
    }

    private sessionInit(ctx: RequestContext): void {
        ctx.sessionId = this.generateId();
        this.application.setCookie(ctx.response, conf.session.cookieName, ctx.sessionId, conf.session.durationSeconds);

        // create and store session entry
        let sessionEntry: SessionEntry = {
            sessionId: ctx.sessionId,
            lastRequest: new Date().getTime(),
            data: {}
        }

        this.sessions[ctx.sessionId] = sessionEntry;
    }

    private generateId(): string {
        let generators = [
            // uppercase letters
            function(): string {
                return String.fromCharCode(65 + Math.floor(Math.random() * 25));
            },
            // lowercase letters
            function(): string {
                return String.fromCharCode(97 + Math.floor(Math.random() * 25));
            },
            // numbers
            function(): string {
                return String.fromCharCode(48 + Math.floor(Math.random() * 10));
            }
        ]

        let id = '';

        while (id.length < conf.session.keyLength) {
            let generator = generators[Math.floor(Math.random() * generators.length)];
            id += generator();
        }

        return id;
    }

    // remove expired session entries
    private garbageCollect(): void {
        let time = new Date().getTime();
        let sessDurationMilliseconds = conf.session.durationSeconds * 1000;

        for (let sessionId in this.sessions) {
            let sess = this.sessions[sessionId];
            if (time - sess.lastRequest > sessDurationMilliseconds) {
                // expired session
                delete this.sessions[sessionId];
            }
        }

        // resume garbage collection after configured interval
        setTimeout(() => {
            this.garbageCollect();
        }, conf.session.garbageCollectIntervalSeconds * 1000);
    }

    // reason for sessionId being allowed as undefined|null is that RequestContext.sessionId can be undefined
    public setValue(sessionId: string|undefined, key: string, value: any): void {
        if (sessionId === undefined) {return;}
        if (this.sessions[sessionId]) {
            let session = this.sessions[sessionId];
            session.data[key] = value;
        }
    }
    
    // value or null if session does not exist
    public getValue(sessionId: string|undefined, key: string): any {
        if (sessionId === undefined) {return null;}
        if (this.sessions[sessionId]) {
            let session = this.sessions[sessionId];
            return session.data[key];
        }
        return null;
    }

    public removeValue(sessionId: string|undefined, key: string): void {
        if (sessionId === undefined) {return;}
        if (this.sessions[sessionId] && this.sessions[sessionId].data[key]) {
            delete this.sessions[sessionId].data[key];
        }
    }

    // remove all stored data for the given session
    public clear(sessionId: string|undefined) {
        if (sessionId === undefined) {return;}
        if (this.sessions[sessionId]) {
            this.sessions[sessionId].data = {};
        }
    }

    // extract given keys from session and return them as an object
    // key in keys can be a string in which case the key will remain the same in returned object
    // or it can be an object { keyInSession : keyInReturnedData } in which case key in returned data will be keyInReturnedData
    public extract(sessionId: string|undefined, keys: Array<string|{ [keyInSession: string] : string }>): LooseObject {
        if (sessionId === undefined) {return {};}
        let data: LooseObject = {};
        keys.forEach((key) => {
            if (typeof key === 'string') {
                data[key] = this.getValue(sessionId, key);
            } else {
                let keyInSession = Object.keys(key)[0];
                let keyReturned = key[keyInSession];
                data[keyReturned] = this.getValue(sessionId, keyInSession);
            }
        });
        return data;
    }

}