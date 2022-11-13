import { createServer, IncomingMessage, Server, ServerResponse } from 'http';
import { ApplicationCallbacks, RequestCallback, RequestContext, RequestHandler, RequestMethod, URIArguments, URISegmentPattern } from '../Types';
import { Components } from './Components';
import { EventEmitter } from 'node:events';
import conf from '../../app/Config';
import { existsSync, readFileSync } from 'fs';
import * as path from 'path';
import * as mime from 'mime-types';

export class Application {

    host: undefined|string;
    port: number;

    server: null|Server = null;
    listening: boolean = false;

    requestHandlers: Array<RequestHandler> = [];

    components: Components = new Components();

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

        this.start();
    }

    start(): void {
        // start the http server
        this.server = createServer((req, res) => {
            this.requestHandle(req, res);
        });
        this.server.listen(this.port, this.host, () => {
            let address = (this.host !== undefined ? this.host : '') + ':' + this.port;
            this.emit('serverStarted');
            console.log(`Server started on ${address}`);
        });
    }

    // handle a request
    async requestHandle(request: IncomingMessage, response: ServerResponse): Promise<void> {
        let uri = request.url || '';
        let handler = this.getRequestHandler(uri, request.method as RequestMethod);
        
        let context: RequestContext = {
            request,
            response,
            handler,
            args: {},
            data: {}
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

    addRequestHandler(methods: Array<RequestMethod>, pattern: string|RegExp, callback: RequestCallback, scope?: any) {

        if (scope === undefined) {
            scope = this;
        }

        let match = typeof pattern === 'string' ? this.patternToSegments(pattern) : pattern;

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

    getRequestHandler(uri: string, method: RequestMethod): null|RequestHandler {
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

    extractURIArguments(uri: string, match: Array<URISegmentPattern>|RegExp): URIArguments {
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
    patternToSegments(pattern: string): Array<URISegmentPattern> {
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

    on(evt: ApplicationCallbacks, callback: RequestCallback) {
        this.eventEmitter.on(evt, callback);
    }

    // we want to be able to await it so we won't call EventEmitter.emit
    // instead we'll manually execute the listeners awaiting each in the process
    async emit(evt: ApplicationCallbacks, payload?: any): Promise<void> {
        let listeners = this.eventEmitter.rawListeners(evt);
        for (let i = 0; i < listeners.length; i++) {
            await listeners[i](payload);
        }
        return;
    }

    contentType(extension: string): string|false {
        return mime.contentType(extension);
    }

    redirect(response: ServerResponse, to: string, statusCode: number = 302): void {
        response.setHeader('Location', to);
        response.writeHead(statusCode);
    }

    async parseRequestBody(ctx: RequestContext): Promise<void> {
        if (ctx.request.headers['content-type']) {

            const dataRaw = await this.requestDataRaw(ctx.request);

            if (ctx.request.headers['content-type'].indexOf('urlencoded') > -1) {
                // application/x-www-form-urlencoded
                // remove has from the URI
                let parts = dataRaw.split('#');
                if (parts.length > 1) {
                    parts.pop();
                }
                let queryString = parts.join('#');
                let argPairs = queryString.split('&');
                let args: URIArguments = {}
                argPairs.forEach((arg) => {
                    let parts = arg.split('=');
                    if (parts.length >= 2) {
                        args[parts[0]] = parts.slice(1).join('=');
                    } else {
                        args[parts[0]] = parts[1];
                    }
                });
                ctx.body = args;
            }
        }
    }

    requestDataRaw(request: IncomingMessage): Promise<string> {
        return new Promise((resolve, reject) => {
            let data = '';
            request.on('data', (chunk) => {
                data += chunk.toString();
            });
    
            request.on('close', () => {
                resolve(data);
            });

            request.on('error', (e) => {
                reject(e);
            });
        });
    }

}