import { EventEmitter } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import { createServer, Server } from 'node:http';
import * as path from 'node:path';
import * as mime from 'mime-types';
import { ApplicationEvents, LooseObject, RequestBodyArguments, RequestContext, StructuredConfig } from '../Types.js';
import { Document } from './Document.js';
import { Components } from './Components.js';
import { Session } from './Session.js';
import { toSnakeCase } from '../Util.js';
import { Request } from './Request.js';
import { Handlebars } from './Handlebars.js';
import { Cookies } from './Cookies.js';

export class Application {
    readonly config: StructuredConfig;

    private initialized: boolean = false;

    server: null|Server = null;
    listening: boolean = false;

    private readonly eventEmitter: EventEmitter = new EventEmitter();

    readonly cookies: Cookies;
    readonly session: Session;
    readonly request: Request;
    readonly components: Components;

    // handlebars helpers manager
    readonly handlebars: Handlebars = new Handlebars();

    // fields from RequestContext.data to be exported for all components
    readonly exportedRequestContextData: Array<keyof RequestContextData> = [];

    constructor(config: StructuredConfig) {
        this.config = config;

        this.cookies = new Cookies();
        this.session = new Session(this);
        this.request = new Request(this);
        this.components = new Components(this);

        // enable sessions
        this.session.start();

        if (this.config.autoInit) {
            this.init();
        }
    }

    public async init(): Promise<void> {

        if (this.initialized) {return;}

        // max listeners per event
        this.eventEmitter.setMaxListeners(10);

        // load handlebars helpers
        try {
            await this.handlebars.loadHelpers('../Helpers.js');
        } catch(e) {
            console.error(e.message);
        }

        await this.emit('beforeComponentsLoad');
        this.components.loadComponents();
        await this.emit('afterComponentsLoaded', this.components);


        await this.emit('beforeRoutes');
        await this.request.loadHandlers();
        await this.emit('afterRoutes', this.request);

        if (this.config.url.componentRender !== false) {
            // special request handler, executed when ClientComponent.redraw is called
            this.request.on('POST', `${this.config.url.componentRender}`, async (ctx) => {
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
            if (uri.includes('..')) {return '';} // disallow having ".." in the URL
            const filePath = path.resolve(import.meta.dirname, '..', uri);
            if (existsSync(filePath)) {
                response.setHeader('Content-Type', 'application/javascript');
                return readFileSync(filePath);
            } else {
                response.statusCode = 404;
            }
            return '';
        }, this, true);

        await this.start();

        this.initialized = true;
    }

    // start the http server
    private start(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.server = createServer((req, res) => {
                this.request.handle(req, res);
            });
            this.server.listen(this.config.http.port, this.config.http.host || '127.0.0.1', async () => {
                const address = (this.config.http.host !== undefined ? this.config.http.host : '') + ':' + this.config.http.port;
                await this.emit('serverStarted', this.server);
                console.log(`Server started on ${address}`);
                resolve();
            });
        });
    }

    // add event listener
    public on<E extends ApplicationEvents>(
        evt: E,
        callback: (
            payload:
                E extends 'beforeRequestHandler' | 'afterRequestHandler' | 'beforeAssetAccess' | 'afterAssetAccess' | 'pageNotFound' ? RequestContext :
                E extends 'documentCreated' ? Document :
                E extends 'afterComponentsLoaded' ? Components :
                E extends 'serverStarted' ? Server :
                undefined
        ) => void
    ): void {
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

    // load environment variables
    // if this.config.envPrefix is a string, load all ENV variables starting with [envPrefix]_
    // the method is generic, so user can define the expected return type
    public importEnv<T extends LooseObject>(smartPrimitives: boolean = true): T {
        const values: LooseObject = {}
        const usePrefix = typeof this.config.envPrefix === 'string';
        const prefixLength = usePrefix ? this.config.envPrefix.length : 0;
        for (const key in process.env) {
            if (! usePrefix || key.startsWith(this.config.envPrefix)) {
                // import
                let value: any = process.env[key];
                const keyWithoutPrefix = key.substring(prefixLength + 1);
    
                if (smartPrimitives) {
                    if (value === 'undefined') {
                        value = undefined;
                    } else if (value === 'null') {
                        value = null;
                    } else if (value === 'true') {
                        value = true;
                    } else if (value === 'false') {
                        value = false;
                    } else if (/^-?\d+$/.test(value)) {
                        value = parseInt(value);
                    } else if (/^\d+\.\d+$/.test(value)) {
                        value = parseFloat(value);
                    }
                }
    
                values[keyWithoutPrefix] = value;
            }
        }
        return values as T;
    }

    // export given fields to all components
    public exportContextFields(...fields: Array<keyof RequestContextData>): void {
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

    public async registerPlugin<Opt extends Readonly<LooseObject>>(callback: (app: Application, options: Opt) => void | Promise<void>, opts: NoInfer<Opt>): Promise<void> {
        if (this.initialized) {
            console.warn('Plugin registered after app is initialized, some plugin features may not work.');
        }
        await callback.apply(this, [this, opts]);
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