import { EventEmitter } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import { createServer, Server } from 'node:http';
import * as path from 'node:path';
import * as mime from 'mime-types';
import conf from '../../app/Config.js';
import { ApplicationEvents, LooseObject, RequestBodyArguments, RequestCallback, RequestContext } from '../Types';
import { Document } from './Document.js';
import { Components } from './Components.js';
import { Session } from './Session.js';
import { toSnakeCase } from '../Util.js';
import { Request } from './Request.js';
import { Handlebars } from './Handlebars.js';
import { Cookies } from './Cookies.js';
import { RequestContextData } from '../../app/Types.js';

export class Application {
    host?: string;
    port: number;

    server: null|Server = null;
    listening: boolean = false;

    private readonly eventEmitter: EventEmitter = new EventEmitter();

    readonly cookies: Cookies = new Cookies();
    readonly session: Session = new Session(this);
    readonly request: Request = new Request(this);
    readonly components: Components = new Components();

    // handlebars helpers manager
    readonly handlebars: Handlebars = new Handlebars();

    // fields from RequestContext.data to be exported for all components
    readonly exportedRequestContextData: Array<keyof RequestContextData> = [];

    constructor(port: number, host?: string) {
        this.host = host;
        this.port = port;

        // enable sessions
        this.session.start();

        if (conf.autoInit) {
            this.init();
        }
    }

    public async init() {

        // max listeners per event
        this.eventEmitter.setMaxListeners(10);

        // load handlebars helpers
        try {
            await this.handlebars.loadHelpers('../Helpers.js');
        } catch(e) {
            console.error(e.message);
        }

        await this.emit('beforeComponentLoad');
        this.components.loadComponents();
        await this.emit('afterComponentLoad');


        await this.emit('beforeRoutes');
        await this.request.loadHandlers();
        await this.emit('afterRoutes');

        if (conf.url.componentRender !== false) {
            // special request handler, executed when ClientComponent.redraw is called
            this.request.on('POST', `${conf.url.componentRender}`, async (ctx) => {
                const input = ctx.body as unknown as {
                    component: string,
                    attributes: RequestBodyArguments,
                    unwrap?: boolean
                };
    
                await this.respondWithComponent(ctx, input.component, input.attributes || undefined, typeof input.unwrap === 'boolean' ? input.unwrap : true);
            });
        }

        // special request handler, serve the client side JS
        this.request.on('GET', /^\/assets\/client-js/, async ({ request, response }) => {
            const uri = request.url?.substring(18) as string;
            const filePath = path.resolve('./system/', uri);
            if (existsSync(filePath)) {
                response.setHeader('Content-Type', 'application/javascript');
                response.write(readFileSync(filePath));
                response.end();
            } else {
                response.statusCode = 404;
            }
            return;
        }, this, true);

        await this.start();
    }

    // start the http server
    public start(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.server = createServer((req, res) => {
                this.request.handle(req, res);
            });
            this.server.listen(this.port, this.host || '127.0.0.1', async () => {
                const address = (this.host !== undefined ? this.host : '') + ':' + this.port;
                await this.emit('serverStarted');
                console.log(`Server started on ${address}`);
                resolve();
            });
        });
    }

    // add event listener
    public on(evt: ApplicationEvents, callback: RequestCallback|((payload?: any) => void)) {
        this.eventEmitter.on(evt, callback);
    }

    // emit an event on Application
    // this will run all event listeners attached to given eventName
    // providing the payload as the first argument
    // returns an array of all resolved values, any rejected promise values are discarded
    public async emit(eventName: ApplicationEvents, payload?: any): Promise<Array<any>> {
        const promises: Array<Promise<any>> = [];
        const listeners = this.eventEmitter.rawListeners(eventName);
        for (let i = 0; i < listeners.length; i++) {
            promises.push(listeners[i](payload));
        }
        const results = await Promise.allSettled(promises);
        return results.filter((res) => {
            return res.status === 'fulfilled';
        }).map((res) => {
            return res.value;
        });
    }

    // export given fields to all components
    public exportContextFields(...fields: Array<keyof RequestContextData>) {
        fields.forEach((field) => {
            if (! this.exportedRequestContextData.includes(field)) {
                this.exportedRequestContextData.push(field);
            }
        });
    }

    // given file extension (or file name), returns the appropriate content-type
    public contentType(extension: string): string|false {
        return mime.contentType(extension);
    }

    // renders a component with give data and sends it as a response
    private async respondWithComponent(ctx: RequestContext, componentName: string, attributes: RequestBodyArguments, unwrap: boolean = true): Promise<boolean> {
        const component = this.components.getByName(componentName);
        if (component) {
            const document = new Document(this, '', ctx);
            const data: LooseObject = attributes;
            await document.loadComponent(component.name, data);

            const exportedData = component.exportData ? document.data : (component.exportFields ? component.exportFields.reduce((prev, curr) => {
                prev[curr] = document.children[0].data[curr];
                return prev;
            }, {} as LooseObject) : {});

            ctx.respondWith({
                html: document.children[0].dom[unwrap ? 'innerHTML' : 'outerHTML'],
                initializers: document.initInitializers(),
                data: exportedData
            });

            return true;
        }
        return false;
    }

    public memoryUsage(): NodeJS.MemoryUsage {
        return process.memoryUsage();
    }

    public printMemoryUsage(): void {
        const usage = this.memoryUsage();
        let total = 0;
        const totals = Object.keys(usage).reduce((prev, key: keyof NodeJS.MemoryUsage) => {
            const usedMb = usage[key] / 1000000;
            prev[toSnakeCase(key).replaceAll('_', ' ')] = [parseFloat(usedMb.toFixed(1)), 'Mb'];
            total += usedMb;
            return prev;
        }, {} as LooseObject);
        totals.total = [parseFloat(total.toFixed(1)), 'Mb'];
        console.table(totals);
    }

}