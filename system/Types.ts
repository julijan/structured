import { IncomingMessage, ServerResponse } from "http";

export type RequestMethod = 'GET'|'POST'|'PUT'|'PATCH'|'DELETE';

export type RequestCallback = (ctx: RequestContext) => Promise<any>

export type RequestHandler = {
    match: Array<URISegmentPattern>|RegExp,
    methods: Array<RequestMethod>,
    callback: RequestCallback,
    scope: any
}

export type RequestContext = {
    request: IncomingMessage,
    response: ServerResponse,
    args: URIArguments,
    handler: null|RequestHandler,

    body?: URIArguments,

    // user defined data
    data: LooseObject
}

export type URISegmentPattern = {
    pattern: string|RegExp,
    name?: string,
    type?: 'string'|'number'
}

export type URIArguments = {
    [key: string] : string|number|RegExpExecArray
}

export type DocumentResource = {
    path: string,
    priority: number
}

export type ComponentEntry = {
    name: string,
    path: string,
    hasJS: boolean,
    pathJS?: string,
    module?: any
}

export interface ComponentScaffold  {
    primaryKey: string,
    getData(): Promise<LooseObject>,
    create?(entry: LooseObject): Promise<any>,
    delete?(id: string): Promise<any>
}

export type LooseObject = {
    [key: string] : any
}

export type ApplicationCallbacks = 'serverStarted'|'beforeRequestHandler'|'afterRequestHandler';