import { IncomingMessage, ServerResponse } from "node:http";
import { LooseObject } from '../types/general.types.js';
import {
    RequestMethod,
    URISegmentPattern,
    RequestHandler,
    RequestCallback,
} from "../types/request.types.js";
import { Application } from "./Application.js";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { RequestContext } from "./RequestContext.js";
import { Document } from "./Document.js";

export class Request {

    private app: Application;

    pageNotFoundCallback: RequestCallback<void | Document, LooseObject | undefined> =  async ({ response }) => {
        response.statusCode = 404;
        response.write('Page not found');
        response.end();
    };

    constructor(app: Application) {
        this.app = app;
    }

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
    // if not then it tries to serve a static asset if path is allowed by Config.assets.allow
    // if it's not allowed or the asset does not exits, 404 callback is executed
    public async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
        const requestMethod = request.method as RequestMethod;

        let uri = request.url || '/';

        if (this.app.config.url.removeTrailingSlash && uri.length > 1 && uri.endsWith('/')) {
            uri = uri.substring(0, uri.length - 1);
        }

        // remove the query string part of the URL
        if (uri.indexOf('?') > -1) {
            const uriParts = uri.split('?');
            uri = uriParts[0];
        }

        // get the best matching request handler
        const handler = this.getHandler(uri, requestMethod);

        // initialize RequestContext, which will handle the request
        new RequestContext(
            this.app,
            request,
            response,
            handler,
            this.pageNotFoundCallback
        );
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
    }

}