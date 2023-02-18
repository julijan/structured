import { EventEmitter } from 'node:events';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { createServer, IncomingMessage, Server, ServerResponse } from 'http';
import * as path from 'path';
import * as mime from 'mime-types';
import * as multipartFormDataParser from 'parse-multipart-data';

import conf from '../../app/Config.js';
import { ApplicationCallbacks, ComponentEntry, DocumentResource, LooseObject, RequestBodyArguments, RequestBodyFiles, RequestCallback, RequestContext, RequestHandler, RequestMethod, URIArguments, URISegmentPattern } from '../Types';
import { Document } from './Document.js';
import { Components } from './Components.js';
import { Session } from './Session.js';
import { HelperDelegate } from 'handlebars';
import { symbolArrays } from '../Symbols.js';

export class Application {

    host: undefined|string;
    port: number;

    server: null|Server = null;
    listening: boolean = false;

    requestHandlers: Array<RequestHandler> = [];

    components: Components = new Components();
    session: Session;

    eventEmitter: EventEmitter = new EventEmitter();

    // CSS/JS included with each page
    commonCSS: Array<DocumentResource> = [];
    commonJS: Array<DocumentResource> = [];

    favicon: {
        image: string|null,
        type: string
    } = {
        image: null,
        type: 'image/png'
    };

    pagneNotFoundCallback: RequestCallback;

    handlebarsHelpers: Array<{
        name: string,
        helper: HelperDelegate
    }> = [];

    constructor(port: number, host?: string) {
        this.host = host;
        this.port = port;


        // create the session instance
        // this won't start the session handler
        // user needs to explicitly start it by calling Application.Session.start
        this.session = new Session(this);

        // enable sessions
        this.session.start();

        this.pagneNotFoundCallback = async ({ response }) => {
            response.statusCode = 404;
            response.write('Page not found');
        }

        if (conf.autoInit) {
            this.init();
        }
    }

    public async init() {

        this.eventEmitter.setMaxListeners(10);

        // {{{htmlTag tagName}}} outputs <tagName></tagName>
        await this.handlebarsRegisterHelper('htmlTag', function(...args) {
            // output a tag with given name
            return `<${args[0]}></${args[0]}>`;
        });

        // {{{layoutComponent componentName data}}} outputs <tagName data-use="data.key0,data.key1..."></tagName>
        await this.handlebarsRegisterHelper('layoutComponent', function(...args) {
            // output a tag with given name
            if (args.length < 2 || args.length > 4) {
                console.warn('layoutComponent expects 1 - 3 arguments (componentName, data?, attributes?) got ' + (args.length - 1));
            }

            const componentName = args[0];
            let data = {}
            let attributes: LooseObject = {};

            let useString = '';
            let attributesString = '';

            if (args.length > 2) {
                // got data
                data = args[1];
                if (data) {
                    const useKeys = Object.keys(data);
                    useString = useKeys.map((item) => {
                        return `data.${item}`;
                    }).join(',');
                }
            }

            if (args.length > 3) {
                // got attributes
                attributes = args[2];
                if (attributes) {
                    const attrNames = Object.keys(attributes);
                    attributesString = attrNames.map((attrName) => {
                        const val = attributes[attrName];
                        if (typeof val === 'string' || typeof val === 'number') {
                            return `${attrName}="${val}"`
                        }
                        if (val === true) {
                            return attrName;
                        }
                        return null;
                    }).filter((val) => val !== null).join(' ');
                }
            }
            
            return `<${componentName}${useString.length > 0 ? ` data-use="${useString}"` : ''} ${attributesString}></${componentName}>`;
        });

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

        this.addRequestHandler('GET', /^\/assets\/client-js/, async ({ request, response }) => {
            // special request handler, serve the client side JS
            const filePath = request.url?.substring(18) as string;
            response.setHeader('Content-Type', 'application/javascript');
            response.write(readFileSync(path.resolve('./system/', filePath)));
            response.end();
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
        const uri = request.url || '';

        const handler = this.getRequestHandler(uri, request.method as RequestMethod);

        const app = this;
        
        const context: RequestContext = {
            request,
            response,
            handler,
            args: {},
            data: {},
            cookies: this.parseCookies(request),
            isAjax : request.headers['x-requested-with'] == 'xmlhttprequest',
            respondWith: function (data: any) {
                if (typeof data === 'string') {
                    response.write(data);
                } else if (data instanceof Document) {
                    response.write(data.toString());
                } else if (data === undefined || data === null) {
                    response.write('');
                } else {
                    response.write(JSON.stringify(data, null, 4));
                }
            },
            redirect: function(to: string, statusCode: number = 302) {
                app.redirect(response, to, statusCode);
            },
            show404: async function() {}
        }

        context.show404 = async function() {
            await app.pagneNotFoundCallback.apply(this, [context]);
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
                // directory up to get out of build
                const assetPath = path.resolve('../' + context.request.url);
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
                await this.pagneNotFoundCallback.apply(this, [context]);
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

    // set a cookie
    // header is set, but is not sent, it will be sent with the output
    public setCookie(response: ServerResponse, name: string, value: string|number, lifetimeSeconds: number, path: string = '/', sameSite: string = 'Strict') {
        const expiresAt = lifetimeSeconds > 0 ? new Date(new Date().getTime() + lifetimeSeconds * 1000).toUTCString() : 0;
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
                const queryString = ctx.bodyRaw.toString().replaceAll('+', ' ');

                const argPairs = queryString.split('&');
                const args: RequestBodyArguments = {}
                argPairs.forEach((arg) => {
                    const parts = arg.split('=');
                    let key = decodeURIComponent(parts[0]);
                    const isArray = key.endsWith('[]');
                    if (isArray) {
                        key = key.slice(0, key.length - 2);
                    }
                    if (isArray && ! args[symbolArrays]) {
                        args[symbolArrays] = {};
                    }
                    if (parts.length > 2) {
                        if (! isArray) {
                            args[key] = decodeURIComponent(parts.slice(1).join('='));
                        } else {
                            // @ts-ignore
                            if (! args[symbolArrays][key]) {
                                // @ts-ignore
                                args[symbolArrays][key] = [];
                            }
                            // @ts-ignore
                            args[symbolArrays][key].push(parts.slice(1).join('='));
                        }
                    } else {
                        if (! isArray) {
                            args[key] = decodeURIComponent(parts[1]);
                        } else {
                            // @ts-ignore
                            if (! args[symbolArrays][key]) {
                                // @ts-ignore
                                args[symbolArrays][key] = [];
                            }
                            // @ts-ignore
                            args[symbolArrays][key].push(decodeURIComponent(parts[1]));
                        }
                    }
                });
                ctx.body = args;
            } else if (ctx.request.headers['content-type'].indexOf('multipart/form-data') > -1) {
                let boundary: RegExpExecArray|null|string = /^multipart\/form-data; boundary=(.+)$/.exec(ctx.request.headers['content-type']);
                if (boundary) {
                    boundary = boundary[1];
                    const data = multipartFormDataParser.parse(ctx.bodyRaw, boundary);

                    // format data as LooseObject
                    const dataFormatted:LooseObject = {};
                    const files: RequestBodyFiles = {};

                    data.forEach((item) => {
                        if (item.name) {
                            if (! item.filename) {
                                // not a file
                                // fix arrays
                                const isArray = /\[.*?\]/.test(item.name);
                                if (! isArray) {
                                    dataFormatted[item.name] = item.data.toString();
                                } else {
                                    // an array
                                    const name = item.name.substring(0, item.name.indexOf('['));
                                    let dataObject = dataFormatted;

                                    if (! dataObject[name]) {
                                        const obj: Array<any> = [];
                                        dataObject[name] = obj;
                                        dataObject = obj;
                                    } else {
                                        dataObject = dataObject[name];
                                    }

                                    let itemName = item.name;
                                    const path = [];
                                    while (/\[.*\]/.test(itemName) != null) {
                                        const res = /\[(.*?)\]/.exec(itemName);
                                        if (res) {
                                            itemName = itemName.substring(res.index + res[1].length + 2);
                                            path.push(/^\d+$/.test(res[1]) ? parseInt(res[1]) : res[1]);
                                        } else {
                                            break;
                                        }

                                    }

                                    // create path
                                    if (path.length > 1) {
                                        // nested
                                        const parts = path.slice(0, path.length - 1);
                                        parts.forEach((part) => {
                                            if (! dataObject[part]) {
                                                const obj: Array<any> = [];
                                                dataObject[part] = obj;
                                                dataObject = obj;
                                            } else {
                                                dataObject = dataObject[part];
                                            }
                                        })
                                    }

                                    const key = path[path.length - 1];

                                    if (key !== '') {
                                        dataObject[key] = item.data.toString();
                                    } else {
                                        dataObject.push(item.data.toString());
                                    }
                                }
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

    private parseCookies(request: IncomingMessage): LooseObject {
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
                const fn = (await import(filePath)).default;
                if (typeof fn === 'function') {
                    await fn(this);
                }
            }
        }

        return;
    }

    private async respondWithComponent(ctx: RequestContext, componentName: string, attributes: RequestBodyArguments, data?: LooseObject, unwrap: boolean = true): Promise<boolean> {

        // console.log('unwrap', unwrap);

        const component = this.component(componentName);
        if (component) {
            const document = new Document(this, '', ctx);
            const attributesArray: Array<string> = [];
            for (const attributeName in attributes) {
                // const attrData = attributeValueFromString(attributes[attributeName]);
                // console.log(attrData);
                const attr = `${attributeName}="${attributes[attributeName]}"`;
                attributesArray.push(attr);
            }
            const attributesString = attributesArray.join(' ');
            const useString = data ? ' data-use="'+ Object.keys(data).join(',') +'"' : '';
            await document.init(`<${componentName} ${attributesString}${useString}></${componentName}>`, data, true);

            if (unwrap) {
                ctx.response.write(document.children[0].dom.innerHTML);
            } else {
                ctx.response.write(document.body());
            }

            return true;
        }
        return false;
    }

    public async handlebarsRegisterHelper(name: string, helper: HelperDelegate): Promise<void> {
        const helperItem = {name, helper};
        this.handlebarsHelpers.push(helperItem);
    }

}