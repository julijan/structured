import { EventEmitter } from 'node:events';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { createServer, IncomingMessage, Server, ServerResponse } from 'http';
import * as path from 'path';
import * as mime from 'mime-types';
import * as multipartFormDataParser from 'parse-multipart-data';

import conf from '../../app/Config.js';
import { ApplicationCallbacks, ComponentEntry, LooseObject, RequestBodyArguments, RequestBodyFiles, RequestCallback, RequestContext, RequestHandler, RequestMethod, URIArguments, URISegmentPattern } from '../Types';
import { Document } from './Document.js';
import { Components } from './Components.js';
import { Session } from './Session.js';

export class Application {

    host: undefined|string;
    port: number;

    server: null|Server = null;
    listening: boolean = false;

    requestHandlers: Array<RequestHandler> = [];

    components: Components = new Components();
    session: Session;

    eventEmitter: EventEmitter = new EventEmitter();

    pagneNotFoundCallback: RequestCallback;

    constructor(port: number, host?: string) {
        this.host = host;
        this.port = port;

        this.pagneNotFoundCallback = async ({ response }) => {
            response.statusCode = 404;
            response.write('Page not found');
        }

        this.components.loadComponents();

        // create the session instance
        // this won't start the session handler
        // user needs to explicitly start it by calling Application.Session.start
        this.session = new Session(this);

        // enable sessions
        this.session.start();

        this.registerRoutes();

        this.addRequestHandler('POST', '/componentRender', async (ctx) => {
            const input = ctx.body as unknown as {
                component: string,
                attributes: RequestBodyArguments,
                data?: LooseObject,
                unwrap?: boolean
            };

            await this.respondWithComponent(ctx, input.component, input.attributes || undefined, input.data || undefined, input.unwrap === undefined ? true : input.unwrap);
        });

        this.addRequestHandler('GET', /^\/assets\/client-js/, async ({ request, response }) => {
            // special request handler, serve the client side JS
            const filePath = request.url?.substring(18) as string;
            response.setHeader('Content-Type', 'application/javascript');
            response.write(readFileSync(path.resolve('./system/', filePath)));
            response.end();
            return;
        });

        this.start();
    }

    public start(): Promise<void> {
        // start the http server
        return new Promise((resolve, reject) => {
            this.server = createServer((req, res) => {
                this.requestHandle(req, res);
            });
            this.server.listen(this.port, this.host, async () => {
                let address = (this.host !== undefined ? this.host : '') + ':' + this.port;
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
        let uri = request.url || '';

        let handler = this.getRequestHandler(uri, request.method as RequestMethod);
        
        let context: RequestContext = {
            request,
            response,
            handler,
            args: {},
            data: {},
            cookies: this.parseCookies(request),
            isAjax : request.headers['x-requested-with'] == 'xmlhttprequest'
        }

        await this.emit('beforeRequestHandler', context);

        if (handler !== null) {

            await this.parseRequestBody(context);

            // run the request handler
            let URIArgs = this.extractURIArguments(uri, handler.match);
            context.args = URIArgs;
            await handler.callback.apply(handler.scope, [context]);

            await this.emit('afterRequestHandler', context);
        } else {

            let staticAsset = false;

            // no attached handlers, check if static asset
            if (conf.assets.allow(context.request.url || '')) {
                // static asset
                // directory up to get out of build
                let assetPath = path.resolve('../' + context.request.url);
                if (existsSync(assetPath)) {
                    let extension = (context.request.url || '').split('.').pop();
                    if (extension) {
                        let contentType = this.contentType(extension);
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
                this.pagneNotFoundCallback.apply(this, [context]);
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

        let match = ((typeof pattern === 'string' ? this.patternToSegments(pattern) : pattern) as RegExp|Array<URISegmentPattern>);

        let handler: RequestHandler = {
            match,
            methods,
            callback,
            scope
        }

        this.requestHandlers.push(handler);

        // sort request handlers so that non-regexp uri's come first, to speed up search
        this.requestHandlers.sort((a, b) => {
            let valA: number = a.match instanceof RegExp ? 1 : 0;
            let valB: number = b.match instanceof RegExp ? 1 : 0;

            return valA - valB;
        });
    }

    // if there is a handler registered for the given URI, returns the handler, null otherwise
    private getRequestHandler(uri: string, method: RequestMethod): null|RequestHandler {
        let segments = uri.split('/');

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
                    let pattern = handler.match[i].pattern;
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

        return possible[0];

    }

    // extract variables from the given URI, using provided match which is defined by current request handler
    // hence this only gets executed for requests that have a registered handler
    private extractURIArguments(uri: string, match: Array<URISegmentPattern>|RegExp): URIArguments {
        if (match instanceof RegExp) {
            let matches = match.exec(uri);
            if (matches) {
                return {
                    matches
                };
            } else {
                return {};
            }
        }

        let uriArgs:URIArguments = {};

        let segments = uri.split('/');

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
        let segments: Array<URISegmentPattern> = [];

        let segmentsIn = pattern.split('/');

        segmentsIn.forEach((segmentIn) => {
            let named = /^\([^\/]+\)$/.test(segmentIn);
            let segmentPattern: URISegmentPattern = {
                pattern: segmentIn,
                type: 'string'
            }
            if (named) {
                let nameParts = /^\(([^\/:\)]+)/.exec(segmentIn);
                let isNumber = /:num\)$/.test(segmentIn);
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
    public on(evt: ApplicationCallbacks, callback: RequestCallback) {
        this.eventEmitter.on(evt, callback);
    }

    // we want to be able to await it so we won't call EventEmitter.emit
    // instead we'll manually execute the listeners awaiting each in the process
    public async emit(evt: ApplicationCallbacks, payload?: any): Promise<void> {
        let listeners = this.eventEmitter.rawListeners(evt);
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

    // set a cookie
    // header is set, but is not sent, it will be sent with the output
    public setCookie(response: ServerResponse, name: string, value: string|number, lifetimeSeconds: number, path: string = '/', sameSite: string = 'Strict') {
        let expiresAt = new Date(new Date().getTime() + lifetimeSeconds * 1000).toUTCString();
        response.setHeader('Set-Cookie', `${name}=${value}; Expires=${expiresAt}; Path=${path}; SameSite=${sameSite}`);
    }

    // parse raw request body
    // if there is a parser then ctx.body is populated with data: URIArgs
    private async parseRequestBody(ctx: RequestContext): Promise<void> {
        if (ctx.request.headers['content-type']) {

            ctx.bodyRaw = await this.requestDataRaw(ctx.request);

            if (ctx.request.headers['content-type'].indexOf('urlencoded') > -1) {
                // application/x-www-form-urlencoded

                // replace + with spaces
                let queryString = ctx.bodyRaw.toString().replaceAll('+', ' ');

                let argPairs = queryString.split('&');
                let args: RequestBodyArguments = {}
                argPairs.forEach((arg) => {
                    let parts = arg.split('=');
                    if (parts.length > 2) {
                        args[decodeURIComponent(parts[0])] = decodeURIComponent(parts.slice(1).join('='));
                    } else {
                        args[decodeURIComponent(parts[0])] = decodeURIComponent(parts[1]);
                    }
                });
                ctx.body = args;
            } else if (ctx.request.headers['content-type'].indexOf('multipart/form-data') > -1) {
                let boundary: RegExpExecArray|null|string = /^multipart\/form-data; boundary=(.+)$/.exec(ctx.request.headers['content-type']);
                if (boundary) {
                    boundary = boundary[1];
                    let data = multipartFormDataParser.parse(ctx.bodyRaw, boundary);

                    // format data as LooseObject
                    let dataFormatted:LooseObject = {};
                    let files: RequestBodyFiles = {};

                    data.forEach((item) => {
                        if (item.name) {
                            if (! item.filename) {
                                dataFormatted[item.name] = item.data.toString();
                            } else {
                                // file, keep entire item
                                files[item.name] = {
                                    fileName: item.filename,
                                    data : item.data,
                                    type : item.type
                                };
                            }
                        }
                    });

                    ctx.body = dataFormatted;
                    ctx.files = files;

                }
            } else if (ctx.request.headers['content-type'].indexOf('application/json') > -1) {
                // application/json
                ctx.body = JSON.parse(ctx.bodyRaw.toString());
            }
        }
        return;
    }

    private parseCookies(request: IncomingMessage): LooseObject {
        if (! request.headers.cookie) {return {};}
        let cookieString = request.headers.cookie;
        let cookiePairs = cookieString.split(';');

        let cookies: LooseObject = {}

        cookiePairs.forEach((cookiePair) => {
            let parts = cookiePair.trim().split('=');
            cookies[parts.shift() || ''] = parts.join('=');
        });

        return cookies;
    }

    // returns the raw request data (eg. POST'ed data)
    private requestDataRaw(request: IncomingMessage): Promise<Buffer> {

        let chunks: Array<Buffer> = [];


        return new Promise((resolve, reject) => {
            request.on('data', (chunk) => {
                chunks.push(chunk);
            });
    
            request.on('close', () => {
                // calculate the total size of all chunks
                let size = chunks.reduce((prev, curr) => {
                    return prev + curr.length;
                }, 0);

                // combine the chunks to form final data
                let data = Buffer.concat(chunks, size);
                
                resolve(data);
            });

            request.on('error', (e) => {
                reject(e);
            });
        });
    }

    private registerRoutes(basePath?: string): void {
        let routesPath:string;
        if (basePath) {
            routesPath = basePath;
        } else {
            routesPath = path.resolve(`../build/${conf.routes.path}`);
        }
        let files = readdirSync(routesPath);
        
        files.forEach(async (file) => {
            let filePath = path.resolve(routesPath + '/' + file);
            let isDirectory = statSync(filePath).isDirectory();
            if (isDirectory) {
                this.registerRoutes(filePath);
            } else {
                let fn = (await import(filePath)).default;
                if (typeof fn === 'function') {
                    fn(this);
                }
            }
        });
    }

    private async respondWithComponent(ctx: RequestContext, componentName: string, attributes: RequestBodyArguments, data?: LooseObject, unwrap: boolean = true): Promise<boolean> {

        console.log('unwrap', unwrap);

        const component = this.component(componentName);
        if (component) {
            const document = new Document(this, '', ctx);
            const attributesArray: Array<string> = [];
            for (const attributeName in attributes) {
                const attr = `${attributeName}="${attributes[attributeName]}"`;
                attributesArray.push(attr);
            }
            const attributesString = attributesArray.join(' ');
            await document.init(`<${componentName} ${attributesString}></${componentName}>`, data, true);

            if (unwrap) {
                ctx.response.write(document.children[0].dom.innerHTML);
            } else {
                ctx.response.write(document.body());
            }

            return true;
        }
        return false;
    }

}