import { LooseObject } from './general.types.js';
import { symbolArrays } from "../Symbols.js";
import { RequestContext } from '../server/RequestContext.js';

export type RequestMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type RequestCallback<
    Response extends any,
    Body extends LooseObject | undefined,
    Segments extends LooseObject,
> = (ctx: RequestContext<Body, Segments>) => Promise<Response>;

export type RequestHandler = {
    match: Array<URISegmentPattern> | RegExp;
    methods: Array<RequestMethod>;
    callback: RequestCallback<any, LooseObject | undefined, LooseObject>;
    scope: any;

    // if true, no (before/after)RequestHandler event is emitted, body and GET args not parsed
    staticAsset: boolean;
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

export type URIPattern = string | RegExp | Array<string | RegExp>;

export type URISegmentPattern = {
    pattern: string | RegExp;
    name?: string;
    type?: 'string' | 'number';
};

export type URIArguments = {
    [key: string]: string | number | RegExpExecArray;
};

// return type of the captured segment
type ParseSegment<T extends string> = 
    T extends `${infer Key}:${infer Type}` ?
        // capture segment with type suffix
        Type extends 'num' | 'number' ?
            // number
            { [K in Key]: number }
            // unrecognized type suffix
            : { [K in Key]: string }
        :
        // no type suffix - string
        { [K in T]: string };

// recursively extract captured segments from the pattern
type ExtractCaptures<T extends string> = 
    T extends `${string}(${infer Param})${infer Rest}` ?
        ParseSegment<Param> & ExtractCaptures<Rest> :
        {};

type UnionToIntersection<U> = 
    (U extends any ? (k: U) => void : never) extends ((k: infer I) => void) ? I : never;

// set key as optional when it's not present in all given patterns
type Optionalize<U> = 
    {
        [K in keyof UnionToIntersection<U> as [U] extends [Record<K, any>] ? K : never]: UnionToIntersection<U>[K]
    } & {
        [K in keyof UnionToIntersection<U> as [U] extends [Record<K, any>] ? never : K]?: UnionToIntersection<U>[K]
    };

// extract the type of RequestContext.args given a pattern or array of patterns
export type ExtractUrlParams<T> = 
    T extends RegExp ?
        // RegExp - we don't know the type
        {} :
        T extends readonly any[] ?
            // array of patterns
            Optionalize<ExtractCaptures<T[number] extends infer U ? (U extends string ? U : never) : never>> :
            // pattern as string
            T extends string ? ExtractCaptures<T> :
            // unexpected type
            {};