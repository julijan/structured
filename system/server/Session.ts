import conf from '../../app/Config.js';
import { RequestContext, SessionEntry } from '../Types.js';
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

    start(): void {
        this.enabled = true;
    }

    stop(): void {
        this.enabled = false;
    }

    sessionInit(ctx: RequestContext): void {
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

    generateId(): string {
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
    garbageCollect(): void {
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

    setValue(sessionId: string, key: string, value: any): void {
        if (this.sessions[sessionId]) {
            let session = this.sessions[sessionId];
            session.data[key] = value;
        }
    }
    
    // value or null if session does not exist
    getValue(sessionId: string, key: string): any {
        if (this.sessions[sessionId]) {
            let session = this.sessions[sessionId];
            return session.data[key];
        }
        return null;
    }

    removeValue(sessionId: string, key: string): void {
        if (this.sessions[sessionId] && this.sessions[sessionId].data[key]) {
            delete this.sessions[sessionId].data[key];
        }
    }

    // remove all stored data for the given session
    clear(sessionId: string) {
        if (this.sessions[sessionId]) {
            this.sessions[sessionId].data = {};
        }
    }

}