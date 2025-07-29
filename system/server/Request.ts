import { IncomingMessage, ServerResponse } from "node:http";
import { LooseObject } from '../types/general.types.js';
import {
    RequestMethod,
    URIArguments,
    URISegmentPattern,
    RequestContext,
    PostedDataDecoded,
    RequestBodyFile,
    RequestHandler,
    RequestCallback,
} from "../types/request.types.js";
import {
    mergeDeep,
    queryStringDecode,
    queryStringDecodedSetValue
} from "../Util.js";
import { Application } from "./Application.js";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { Buffer } from "node:buffer";
import { Document } from "./Document.js";

export class Request {

    private app: Application;

    constructor(app: Application) {
        this.app = app;
    }

    pageNotFoundCallback: RequestCallback<void | Document, LooseObject> =  async ({ response }) => {
        response.statusCode = 404;
        response.write('Page not found');
        response.end();
    };

    // registered request handlers
    private readonly handlers: Array<RequestHandler> = [];

    // registers a request handler for given request method(s) + pattern(s)
    // when a request is made that matches the request method(s) and pattern(s) callback is executed
    // pattern can have matches in it which will later populate ctx.args, eg. /users/(id:num) or /example/(argName)
    // callback.this will be the scope if scope is provided, otherwise scope is the Application instance
    // if pattern is given as array, one request handler will be created for each element of the array
    // if isStaticAsset = true, (before/after)RequestHandler event not emitted, body and GET args not parsed
    public on<R extends any, Body extends LooseObject | undefined = LooseObject>(
        methods: RequestMethod|Array<RequestMethod>,
        pattern: string|RegExp|Array<string|RegExp>,
        callback: RequestCallback<R, Body>,
        scope?: any,
        isStaticAsset: boolean = false
    ): void {

        if (! (methods instanceof Array)) {
            methods = [methods];
        }

        if (scope === undefined) {
            scope = this.app;
        }

        // if pattern was given as an array, call addRequestHandler with each item in array
        if (pattern instanceof Array) {
            pattern.forEach((p) => {
                this.on(methods, p, callback, scope);
            });
            return;
        }

        const match = ((typeof pattern === 'string' ? this.patternToSegments(pattern) : pattern) as RegExp|Array<URISegmentPattern>);

        const handler: RequestHandler = {
            match,
            methods,
            callback,
            scope,
            staticAsset: isStaticAsset
        }

        this.handlers.push(handler);

        // sort request handlers so that non-regexp uri's come first, to speed up search
        this.handlers.sort((a, b) => {
            const valA: number = a.match instanceof RegExp ? 1 : 0;
            const valB: number = b.match instanceof RegExp ? 1 : 0;

            return valA - valB;
        });
    }

    // if there is a handler registered for the given URI, returns the handler, null otherwise
    private getHandler(uri: string, method: RequestMethod): null|RequestHandler {
        const segments = uri.split('/');

        // narrowing down the possible handlers, first iteration
        // any that have the correct number of segments and RegExp's
        let possible = this.handlers.filter((handler) => {
            return handler.methods.includes(method) && (handler.match instanceof RegExp || handler.match.length === segments.length);
        });

        // check uri, segment-by-segment
        for (let i = 0; i < segments.length; i++) {
            possible = possible.filter((handler) => {
                if (handler.match instanceof RegExp) {
                    // match is a RegExp, keep if matches the uri
                    return handler.match.test(uri);
                } else {
                    // handler.match is an array, check against current segment patter
                    // it can be a string or RegExp
                    const pattern = handler.match[i].pattern;
                    if (typeof pattern === 'string') {
                        return pattern === segments[i];
                    }

                    // current segment pattern is a RegExp
                    return pattern.test(segments[i]);
                }
            });
        }

        // no possible request handlers registered
        if (possible.length === 0) {
            return null;
        }

        // multiple requests handlers match
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

        // return the best match
        return possible[0];
    }

    // handle a request
    // checks whether there is a registered handler for the URL
    // if not then it tries to serve a static asset if path is allowd by Config.assets.allow
    // if it's not allowed or the asset does not exits, 404 callback is executed
    public async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
        const requestMethod = request.method as RequestMethod;

        let uri = request.url || '/';

        if (this.app.config.url.removeTrailingSlash && uri.length > 1 && uri.endsWith('/')) {
            uri = uri.substring(0, uri.length - 1);
        }

        // extract any GET args from the URL-provided query string eg. /page?key=val
        // once extracted, remove the query string part of the URL
        let getArgs = {};
        if (uri.indexOf('?') > -1) {
            const uriParts = uri.split('?');
            uri = uriParts[0];
            getArgs = queryStringDecode(uriParts[1]);
        }

        // get the best matching request handler
        const handler = this.getHandler(uri, requestMethod);
        
        const context: RequestContext<LooseObject | undefined> = {
            request,
            response,
            handler,
            args: {},
            // RequestContext.data is place for user defined data
            // it is initialized as an empty object here and
            // potentially falsely declared as RequestContextData
            // user will fill this out, usually on beforeRequestHandler
            data: {} as RequestContextData,
            body: undefined,
            getArgs,
            cookies: this.app.cookies.parse(request),
            timeStart: new Date().getTime(),
            isAjax : request.headers['x-requested-with'] == 'xmlhttprequest',
            respondWith: function (data: any) {
                if (typeof data === 'string' || Buffer.isBuffer(data)) {
                    response.write(data);
                } else if (typeof data === 'number') {
                    response.write(data.toString());
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
            redirect: (to: string, statusCode: number = 302) => {
                this.redirect(response, to, statusCode);
            },
            show404: async() => {
                // emit pageNotFound before running the callback
                // to allow user to modify RequestContext.data if needed
                this.app.emit('pageNotFound', context);

                // run pageNotFoundCallback callback
                const res = await this.pageNotFoundCallback.apply(this.app, [context]);

                // if pageNotFoundCallback returned a Document, send it as a response
                if (res instanceof Document) {
                    context.respondWith(res);
                }
            }
        }

        
        if (handler !== null) {
            // handler exists
            if (! handler.staticAsset) {
                // run beforeRequestHandler callbacks
                const results = await this.app.emit('beforeRequestHandler', context);
    
                // if any of the beforeRequestHandler callbacks returned false, end the request here
                // this provides a way for the developer to prevent the request handler from being executed
                // which is useful in some cases, for example:
                // beforeRequestHandler checks if user is logged in, if not redirects to login
                // and returns false to prevent unauthorized access to user-only page
                if (results.includes(false)) {
                    context.response.end();
                    return;
                }
                
                try {
                    // parse request body, this will populate ctx.bodyRaw and if possible ctx.body
                    await this.parseBody(context);
                } catch(e) {
                    console.error(`Error parsing request body: ${e.message}`);
                }

                // extract URI arguments, if pattern included capture groups, those will be included
                // for example pattern /users/(userId:num) -> { userId: number }
                const URIArgs = this.extractURIArguments(uri, handler.match);
                context.args = URIArgs;
            }

            
            // run the request handler callback
            try {
                const response = await handler.callback.apply(handler.scope, [context]);
                if (! context.response.headersSent) {
                    // if the response was not sent from the request handler
                    // respond with whatever the handler has returned
                    context.respondWith(response);
                }
            } catch(e) {
                console.log('Error executing request handler ', e, handler.callback.toString());
            }

            if (! handler.staticAsset) {
                await this.app.emit('afterRequestHandler', context);
            }
        } else {
            // handler not found, check if a static asset is requested
            let staticAsset = false;

            if (this.app.config.url.isAsset(context.request.url || '')) {
                // static asset
                // unless accessing /assets/ts/* go directory up to get out of build
                const basePath = context.request.url?.startsWith('/assets/ts/') ? './' : '../';
                const assetPath = path.resolve(basePath + context.request.url);
                if (existsSync(assetPath)) {
                    await this.app.emit('beforeAssetAccess', context);
                    const extension = (context.request.url || '').split('.').pop();
                    if (extension) {
                        const contentType = this.app.contentType(extension);
                        if (contentType) {
                            response.setHeader('Content-Type',  contentType);
                        }
                    }
                    response.write(readFileSync(assetPath));
                    staticAsset = true;
                    await this.app.emit('afterAssetAccess', context);
                }
            }

            if (! staticAsset) {
                // no request handler found nor a static asset - 404
                await context.show404();
            }

        }

        // end the response
        response.end();
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

    // parse raw request body
    // if there is a parser for received Content-Type
    // then ctx.body is populated with data: URIArgs
    private async parseBody(ctx: RequestContext<LooseObject | undefined>): Promise<void> {
        if (ctx.request.headers['content-type']) {

            ctx.bodyRaw = await this.dataRaw(ctx.request);

            if (ctx.request.headers['content-type'].indexOf('urlencoded') > -1) {
                // application/x-www-form-urlencoded
                const bodyRaw = ctx.bodyRaw.toString('utf-8');
                try {
                    ctx.body = queryStringDecode(bodyRaw);
                } catch (e) {
                    console.error(`Error parsing urlencoded request body for request to ${ctx.request.url}, (${e.message}).
                    Raw data:
                        ${bodyRaw}

                    `);
                }
            } else if (ctx.request.headers['content-type'].indexOf('multipart/form-data') > -1) {
                // multipart/form-data
                let boundary: RegExpExecArray|null|string = /^multipart\/form-data; boundary=(.+)$/.exec(ctx.request.headers['content-type']);
                if (boundary) {
                    boundary = `--${boundary[1]}`;
                    try {
                        ctx.body = Request.parseBodyMultipart(ctx.bodyRaw.toString('utf-8'), boundary);
                    } catch (e) {
                        console.error(`Error parsing multipart request body for request to ${ctx.request.url}, (${e.message}).
                        Raw data:
                            ${ctx.bodyRaw.toString('utf-8')}
                            
                        `);
                    }

                    try {
                        ctx.files = Request.multipartBodyFiles(ctx.bodyRaw.toString('binary'), boundary);
                    } catch (e) {
                        console.error(`Error parsing multipart request body files for request to ${ctx.request.url}, (${e.message}).
                        Raw data:
                            ${ctx.bodyRaw.toString('utf-8')}
                            
                        `);
                    }
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
    private dataRaw(request: IncomingMessage): Promise<Buffer> {
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

    // send the headers to redirect the client, 302 redirect by default
    // should be called before any output (before any res.write)
    public redirect(response: ServerResponse, to: string, statusCode: number = 302): void {
        response.setHeader('Location', to);
        response.writeHead(statusCode);
    }

    // load request handlers from given directory recursively
    // if directory is omitted, loads from conf.routes.path
    public async loadHandlers(basePath?: string): Promise<void> {
        let routesPath:string;
        if (basePath) {
            routesPath = basePath;
        } else {
            routesPath = path.resolve((this.app.config.runtime === 'Node.js' ? '../build/' : './') + this.app.config.routes.path);
        }

        if (! existsSync(routesPath)) {
            throw new Error(`Routes path not found, expected to find:\n${routesPath}`);
        }

        const files = readdirSync(routesPath);

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const filePath = path.resolve(routesPath + '/' + file);
            const isDirectory = statSync(filePath).isDirectory();
            if (isDirectory) {
                // directory
                await this.loadHandlers(filePath);
            } else {
                // file
                if (! (file.endsWith('.js') || file.endsWith('.ts')) || file.endsWith('.d.ts')) {
                    continue;
                }
                const fn = (await import('file:///' + filePath)).default;
                if (typeof fn === 'function') {
                    fn(this.app);
                }
            }
        }

        return;
    }

    public static queryStringDecode(queryString: string, initialValue: PostedDataDecoded = {}, trimValues: boolean = true): PostedDataDecoded {
        return queryStringDecode(queryString, initialValue, trimValues);
    }

    // process raw multipart/form-data body into an object
    // boundary has to be provided as second argument
    public static parseBodyMultipart(bodyRaw: string, boundary: string): PostedDataDecoded {
        const pairsRaw = bodyRaw.split(boundary);
        const pairs = pairsRaw.map((pair) => {
            const parts = pair.split(/\r?\n\r?\n/, 2).filter((part) => {return part.length > 0});
            if (parts.length > 0) {
                const header = parts[0];
                const data = typeof parts[1] === 'string' ? parts[1].trim() : '';
                const headerParts = /Content-Disposition: form-data; name="([^\r\n"]+)"/m.exec(header);
                if (headerParts) {
                    return {
                        key: headerParts[1],
                        value: data
                    }
                }
            }
            return null;
        });
        
        // convert data to query string
        const urlEncoded = pairs.reduce((prev, curr) => {
            if (curr !== null) {
                prev.push(`${curr.key}=${encodeURIComponent(curr.value.replaceAll('&', '%26'))}`);
            }
            return prev;
        }, [] as Array<string>).join('&');
    
        return queryStringDecode(urlEncoded);
    }

    public static multipartBodyFiles(bodyRaw: string, boundary: string): Record<string, RequestBodyFile> {
        let files: Record<string, RequestBodyFile> = {}
        const pairsRaw = bodyRaw.split(boundary);
        pairsRaw.map((pair) => {
            const parts = /Content-Disposition: form-data; name="(.+?)"; filename="(.+?)"\r\nContent-Type: (.*)\r\n\r\n([\s\S]+)$/m.exec(pair);
            if (parts) {
                const file: RequestBodyFile = {
                    data: Buffer.from(parts[4].substring(0, parts[4].length - 2).trim(), 'binary'),
                    fileName: parts[2],
                    type: parts[3]
                }
                // we can't just set the file as files[parts[1]] = file
                // that would work if parts[1] is a simple key without "[.*]" in it
                // but in reality key will often be an object or an array
                // so we need to recursively create the object and fill it with file
                // then merge that result with resulting files object
                files = mergeDeep(files, queryStringDecodedSetValue(parts[1], file));
            }
            return null;
        })
        return files;
    }
}