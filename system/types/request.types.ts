import { IncomingMessage, ServerResponse } from "http";
import { LooseObject } from './general.types.js';
import { symbolArrays } from "../Symbols.js";

export type RequestMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type RequestCallback<R extends any, Body extends LooseObject | undefined> = (ctx: RequestContext<Body>) => Promise<R>;

export type RequestHandler = {
    match: Array<URISegmentPattern> | RegExp;
    methods: Array<RequestMethod>;
    callback: RequestCallback<any, LooseObject | undefined>;
    scope: any;

    // if true, no (before/after)RequestHandler event is emitted, body and GET args not parsed
    staticAsset: boolean;
};

export type RequestContext<Body extends LooseObject | undefined = LooseObject> = {
    request: IncomingMessage;
    response: ServerResponse;
    args: URIArguments;
    handler: null | RequestHandler;

    cookies: Record<string, string>;

    // POSTed data, parsed to object
    body: Body;

    bodyRaw?: Buffer;

    // files extracted from request body
    // currently only multipart/form-data
    files?: Record<string, RequestBodyRecordValue>;

    // user defined data
    data: RequestContextData;

    // if session is started and user has visited any page
    sessionId?: string;

    // true if x-requested-with header is received and it equals 'xmlhttprequest'
    isAjax: boolean;

    getArgs: PostedDataDecoded;

    timeStart: number,

    respondWith: (data: any) => Promise<void>;
    redirect: (to: string, statusCode?: number) => void;
    show404: () => Promise<void>;
};

export type PostedDataDecoded = Record<string, string | boolean | Array<string | boolean | PostedDataDecoded> | Record<string, string | boolean | Array<string | boolean | PostedDataDecoded>> | Record<string, string | boolean | Array<string | boolean>>>;

export type RequestBodyRecordValue = string | Array<RequestBodyRecordValue> | { [key: string]: RequestBodyRecordValue; } | { [key: string]: RequestBodyFile; } | Array<RequestBodyFile> | RequestBodyFile;

export interface RequestBodyArguments {
    [key: string]: RequestBodyRecordValue;
    [symbolArrays]?: {
        [key: string]: Array<string>
    }
}

export type RequestBodyFile = {
    fileName: string;
    data: Buffer;
    type: string;
};

export type RequestBodyFiles = {
    [key: string]: RequestBodyFile;
};

export type URISegmentPattern = {
    pattern: string | RegExp;
    name?: string;
    type?: 'string' | 'number';
};

export type URIArguments = {
    [key: string]: string | number | RegExpExecArray;
};