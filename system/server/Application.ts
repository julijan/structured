import { EventEmitter } from 'node:events';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { createServer, IncomingMessage, Server, ServerResponse } from 'http';
import * as path from 'path';
import * as mime from 'mime-types';
import conf from '../../app/Config.js';
import { ApplicationCallbacks, ComponentEntry, LooseObject, RequestBodyArguments, RequestCallback, RequestContext, RequestHandler, RequestMethod, URIArguments, URISegmentPattern } from '../Types';
import { Document } from './Document.js';
import { Components } from './Components.js';
import { Session } from './Session.js';
import { toSnakeCase } from '../Util.js';
import { Request } from './Request.js';
import { Cookies } from './Cookies.js';
import { RequestContextData } from '../../app/Types.js';
import { Helpers } from './Helpers.js';

export class Application {

    host: undefined|string;
    port: number;

    server: null|Server = null;
    listening: boolean = false;

    readonly requestHandlers: Array<RequestHandler> = [];

    readonly components: Components = new Components();
    readonly session: Session;

    readonly cookies: Cookies = new Cookies();

    private readonly eventEmitter: EventEmitter = new EventEmitter();

    favicon: {
        image: string|null,
        type: string
    } = {
        image: null,
        type: 'image/png'
    };

    pageNotFoundCallback: RequestCallback;

    // handlebars helpers manager
    readonly helpers: Helpers = new Helpers();

    constructor(port: number, host?: string) {
        this.host = host;
        this.port = port;


        // create the session instance
        // this won't start the session handler
        // user needs to explicitly start it by calling Application.Session.start
        this.session = new Session(this);

        // enable sessions
        this.session.start();

        this.pageNotFoundCallback = async ({ response }) => {
            response.statusCode = 404;
            response.write('Page not found');
        }

        if (conf.autoInit) {
            this.init();
        }
    }

    public async init() {

        this.eventEmitter.setMaxListeners(10);

        // load handlebars helpers
        try {
            await this.helpers.loadFrom('../Helpers.js');
        } catch(e) {
            console.error(e.message);
        }

        await this.emit('beforeComponentLoad');
        this.components.loadComponents();
        await this.emit('afterComponentLoad');


        await this.emit('beforeRoutes');
        await this.registerRoutes();
        await this.emit('afterRoutes');

        this.addRequestHandler('POST', '/componentRender', async (ctx) => {
            const input = ctx.body as unknown as {
                component: string,
                attributes: RequestBodyArguments,
                data?: LooseObject,
                unwrap?: boolean
            };

            await this.respondWithComponent(ctx, input.component, input.attributes || undefined, input.data || undefined, input.unwrap === undefined ? true : input.unwrap);
        });

        // special request handler, serve the client side JS
        this.addRequestHandler('GET', /^\/assets\/client-js/, async ({ request, response }) => {
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
        });

        await this.start();
    }

    public start(): Promise<void> {
        // start the http server
        return new Promise((resolve, reject) => {
            this.server = createServer((req, res) => {
                this.requestHandle(req, res);
            });
            this.server.listen(this.port, this.host || '127.0.0.1', async () => {
                const address = (this.host !== undefined ? this.host : '') + ':' + this.port;
                await this.emit('serverStarted');
                console.log(`Server started on ${address}`);
                resolve();
            });
        });
    }

    // handle a request
    // checks whether there is a registered handler for the URL
    // if not then it tries to serve a static asset if path is allowd by Config.assets.allow
    // if it's not allowed or the asset does not exits, 404 callback is executed
    private async requestHandle(request: IncomingMessage, response: ServerResponse): Promise<void> {
        const requestMethod = request.method as RequestMethod;

        let uri = request.url || '/';

        if (uri.length > 1 && conf.removeTrailingSlashURL && uri.endsWith('/')) {
            uri = uri.substring(0, uri.length - 1);
        }

        let getArgs = {};
        if (uri.indexOf('?') > -1) {
            const uriParts = uri.split('?');
            uri = uriParts[0];
            getArgs = Request.queryStringDecode(uriParts[1]);
        }

        const handler = this.getRequestHandler(uri, requestMethod);

        const app = this;
        
        const context: RequestContext = {
            request,
            response,
            handler,
            args: {},
            // RequestContext.data is place for user defined data
            // it is initialized as an empty object here and
            // potentially falsely declared as RequestContextData
            // user will fill this out, usually on beforeRequestHandler
            data: {} as RequestContextData,
            getArgs,
            cookies: this.cookies.parse(request),
            isAjax : request.headers['x-requested-with'] == 'xmlhttprequest',
            respondWith: function (data: any) {
                if (typeof data === 'string' || typeof data === 'number' || Buffer.isBuffer(data)) {
                    response.write(data);
                } else if (data instanceof Document) {
                    response.setHeader('Content-Type', 'text/html');
                    response.write(data.toString());
                } else if (data === undefined || data === null) {
                    response.write('');
                } else {
                    response.setHeader('Content-Type', 'application/json');
                    response.write(JSON.stringify(data, null, 4));
                }
            },
            redirect: function(to: string, statusCode: number = 302) {
                app.redirect(response, to, statusCode);
            },
            show404: async function() {}
        }

        context.show404 = async function() {
            await app.pageNotFoundCallback.apply(this, [context]);
        }

        await this.emit('beforeRequestHandler', context);

        if (handler !== null) {

            try {
                await this.parseRequestBody(context);
            } catch(e) {
                console.log('Error parsing request body');
            }

            const URIArgs = this.extractURIArguments(uri, handler.match);
            context.args = URIArgs;
            
            // run the request handler
            try {
                await handler.callback.apply(handler.scope, [context]);
            } catch(e) {
                console.log('Error executing request handler ', e, handler.callback.toString());
            }

            await this.emit('afterRequestHandler', context);
        } else {

            let staticAsset = false;

            // no attached handlers, check if static asset
            if (conf.assets.allow(context.request.url || '')) {
                // static asset
                // unless accessing /assets/ts/* go directory up to get out of build
                const basePath = context.request.url?.startsWith('/assets/ts/') ? './' : '../';
                const assetPath = path.resolve(basePath + context.request.url);
                if (existsSync(assetPath)) {
                    const extension = (context.request.url || '').split('.').pop();
                    if (extension) {
                        const contentType = this.contentType(extension);
                        if (contentType) {
                            response.setHeader('Content-Type',  contentType);
                        }
                    }
                    response.write(readFileSync(assetPath));
                    staticAsset = true;
                }
            }

            if (! staticAsset) {
                // no request handler found nor a static asset - 404
                await this.pageNotFoundCallback.apply(this, [context]);
            }

        }

        // end the response
        response.end();
    }

    // registers an event handler for given request methods, pattern, callback and optional scope
    // pattern can have matches in it which will later populate ctx.args, eg. /users/(id:num) or /example/(argName)
    // callback is the request handler, called when the given URL matches the pattern
    // callback.this will be the scope if scope is provided, otherwise scope is the current Application instance
    // if pattern is given as array, one request handler will be created for each element of the array
    public addRequestHandler(methods: RequestMethod|Array<RequestMethod>, pattern: string|RegExp|Array<string|RegExp>, callback: RequestCallback, scope?: any): void {

        if (! (methods instanceof Array)) {
            methods = [methods];
        }

        if (scope === undefined) {
            scope = this;
        }

        // if pattern was given as an array, call addRequestHandler with each item in array
        if (pattern instanceof Array) {
            pattern.forEach((p) => {
                this.addRequestHandler(methods, p, callback, scope);
            });
            return;
        }

        const match = ((typeof pattern === 'string' ? this.patternToSegments(pattern) : pattern) as RegExp|Array<URISegmentPattern>);

        const handler: RequestHandler = {
            match,
            methods,
            callback,
            scope
        }

        this.requestHandlers.push(handler);

        // sort request handlers so that non-regexp uri's come first, to speed up search
        this.requestHandlers.sort((a, b) => {
            const valA: number = a.match instanceof RegExp ? 1 : 0;
            const valB: number = b.match instanceof RegExp ? 1 : 0;

            return valA - valB;
        });
    }

    // if there is a handler registered for the given URI, returns the handler, null otherwise
    private getRequestHandler(uri: string, method: RequestMethod): null|RequestHandler {
        const segments = uri.split('/');

        let possible = this.requestHandlers.filter((handler) => {
            // method allowed and
            // RegExp or same length as segments
            return handler.methods.includes(method) && (handler.match instanceof RegExp || handler.match.length == segments.length);
        });

        for (let i = 0; i < segments.length; i++) {
            possible = possible.filter((handler) => {
                if (handler.match instanceof RegExp) {
                    return handler.match.test(uri);
                } else {
                    const pattern = handler.match[i].pattern;
                    if (typeof pattern === 'string') {
                        return pattern == segments[i];
                    }

                    // pattern is a RegExp
                    return pattern.test(segments[i]);
                }
            });
        }

        if (possible.length === 0) {
            return null;
        }

        if (possible.length > 1) {
            console.warn(`Multiple request handlers for ${uri}`);
        }

        // prefer constant matches over RegExp
        possible.sort((a, b) => {
            if (a.match instanceof Array && b.match instanceof Array) {
                // a an b are of same length
                for (let i = a.match.length - 1; i > -1; i--) {
                    const aVal = a.match[i].pattern instanceof RegExp ? 1 : 0;
                    const bVal = b.match[i].pattern instanceof RegExp ? 1 : 0;
                    if (aVal != bVal) {
                        return aVal - bVal;
                    }
                }
                return 0;
            }

            const aVal = a.match instanceof RegExp ? 1 : 0;
            const bVal = b.match instanceof RegExp ? 1 : 0;
            return aVal - bVal;
        });

        return possible[0];
    }

    // extract variables from the given URI, using provided match which is defined by current request handler
    // hence this only gets executed for requests that have a registered handler
    private extractURIArguments(uri: string, match: Array<URISegmentPattern>|RegExp): URIArguments {
        if (match instanceof RegExp) {
            const matches = match.exec(uri);
            if (matches) {
                return {
                    matches
                };
            } else {
                return {};
            }
        }

        const uriArgs:URIArguments = {};

        const segments = uri.split('/');

        match.forEach((segmentPattern, i) => {
            if (segmentPattern.name) {
                uriArgs[segmentPattern.name] = segmentPattern.type === 'number' ? parseInt(segments[i]) : segments[i];
            }
        });

        return uriArgs;
    }

    // allows easy access to URI segments
    // (varname) - match any value
    // (varname:num) - match a number
    private patternToSegments(pattern: string): Array<URISegmentPattern> {
        const segments: Array<URISegmentPattern> = [];

        const segmentsIn = pattern.split('/');

        segmentsIn.forEach((segmentIn) => {
            const named = /^\([^\/]+\)$/.test(segmentIn);
            const segmentPattern: URISegmentPattern = {
                pattern: segmentIn,
                type: 'string'
            }
            if (named) {
                const nameParts = /^\(([^\/:\)]+)/.exec(segmentIn);
                const isNumber = /:num\)$/.test(segmentIn);
                if (nameParts) {
                    segmentPattern.name = nameParts[1];
                    if (isNumber) {
                        segmentPattern.pattern = /^(\d+)$/;
                        segmentPattern.type = 'number';
                    } else {
                        segmentPattern.pattern = /^([^\/]+)$/;
                        segmentPattern.type = 'string';
                    }
                } else {
                    console.warn(`Invalid URI segment pattern ${segmentIn} in URI ${pattern}`);
                }
            }
            segments.push(segmentPattern);
        });

        return segments;
    }

    // get ComponentEntry by name, shortcut to Components.getByName
    public component(name: string): ComponentEntry|null {
        return this.components.getByName(name);
    }

    // add event listener
    public on(evt: ApplicationCallbacks|string, callback: RequestCallback|((payload?: any) => void)) {
        this.eventEmitter.on(evt, callback);
    }

    // we want to be able to await it so we won't call EventEmitter.emit
    // instead we'll manually execute the listeners awaiting each in the process
    public async emit(evt: ApplicationCallbacks|string, payload?: any): Promise<void> {
        const listeners = this.eventEmitter.rawListeners(evt);
        for (let i = 0; i < listeners.length; i++) {
            await listeners[i](payload);
        }
        return;
    }

    // given file extension (or file name), returns the appropriate content-type
    public contentType(extension: string): string|false {
        return mime.contentType(extension);
    }

    // send the headers to redirect the client, 302 redirect by default
    // should be called before any output (before any res.write)
    public redirect(response: ServerResponse, to: string, statusCode: number = 302): void {
        response.setHeader('Location', to);
        response.writeHead(statusCode);
    }

    // parse raw request body
    // if there is a parser for received Content-Type
    // then ctx.body is populated with data: URIArgs
    private async parseRequestBody(ctx: Omit<RequestContext, 'data'>): Promise<void> {
        if (ctx.request.headers['content-type']) {

            ctx.bodyRaw = await this.requestDataRaw(ctx.request);

            if (ctx.request.headers['content-type'].indexOf('urlencoded') > -1) {
                // application/x-www-form-urlencoded
                ctx.body = Request.queryStringDecode(ctx.bodyRaw.toString('utf-8'));
            } else if (ctx.request.headers['content-type'].indexOf('multipart/form-data') > -1) {
                // multipart/form-data
                let boundary: RegExpExecArray|null|string = /^multipart\/form-data; boundary=(.+)$/.exec(ctx.request.headers['content-type']);
                if (boundary) {
                    boundary = `--${boundary[1]}`;
                    ctx.body = Request.parseBodyMultipart(ctx.bodyRaw.toString('utf-8'), boundary);
                    ctx.files = Request.multipartBodyFiles(ctx.bodyRaw.toString('binary'), boundary);
                }
            } else if (ctx.request.headers['content-type'].indexOf('application/json') > -1) {
                // application/json
                try {
                    ctx.body = JSON.parse(ctx.bodyRaw.toString());
                } catch (e) {
                    // failed to parse the body
                    ctx.body = undefined;
                }
            }
        }
        return;
    }

    // returns the raw request data (eg. POST'ed data)
    private requestDataRaw(request: IncomingMessage): Promise<Buffer> {

        const chunks: Array<Buffer> = [];

        return new Promise((resolve, reject) => {
            request.on('data', (chunk) => {
                chunks.push(chunk);
            });
    
            request.on('close', () => {
                // calculate the total size of all chunks
                const size = chunks.reduce((prev, curr) => {
                    return prev + curr.length;
                }, 0);

                // combine the chunks to form final data
                const data = Buffer.concat(chunks, size);
                
                resolve(data);
            });

            request.on('error', (e) => {
                reject(e);
            });
        });
    }

    private async registerRoutes(basePath?: string): Promise<void> {
        let routesPath:string;
        if (basePath) {
            routesPath = basePath;
        } else {
            routesPath = path.resolve(`../build/${conf.routes.path}`);
        }
        const files = readdirSync(routesPath);

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const filePath = path.resolve(routesPath + '/' + file);
            const isDirectory = statSync(filePath).isDirectory();
            if (isDirectory) {
                await this.registerRoutes(filePath);
            } else {
                const fn = (await import('file:///' + filePath)).default;
                if (typeof fn === 'function') {
                    await fn(this);
                }
            }
        }

        return;
    }

    private async respondWithComponent(ctx: RequestContext, componentName: string, attributes: RequestBodyArguments, data?: LooseObject, unwrap: boolean = true): Promise<boolean> {
        const component = this.component(componentName);
        if (component) {
            const document = new Document(this, '', ctx);
            const data: LooseObject = attributes;
            await document.loadComponent(component.name, data);

            const exportedData = component.exportData ? document.data : (component.exportFields ? component.exportFields.reduce((prev, curr) => {
                prev[curr] = document.children[0].data[curr];
                return prev;
            }, {} as LooseObject) : {});

            ctx.respondWith({
                html: document.children[0].dom.outerHTML,
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