import { IncomingMessage, ServerResponse } from "http";
import { Application } from "./server/Application.js";
import { symbolArrays } from "./Symbols.js";
import { RequestContextData } from "../app/Types.js";
import { Net } from './client/Net.js';
import { ClientComponent } from './client/ClientComponent.js';

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

    cookies: Record<string, string>,

    // POSTed data, parsed to object
    body?: PostedDataDecoded,

    bodyRaw?: Buffer,

    // files extracted from request body
    // currently only multipart/form-data
    files?: Record<string, RequestBodyRecordValue>,

    // user defined data
    data: RequestContextData,

    // if session is started and user has visited any page
    sessionId?: string,

    // true if x-requested-with header is received and it equals 'xmlhttprequest'
    isAjax: boolean,

    getArgs: PostedDataDecoded,

    respondWith: (data: any) => void,
    redirect: (to: string, statusCode?: number) => void,
    show404: () => Promise<void>
}

export type PostedDataDecoded = Record<string, string | boolean | Array<string | boolean | PostedDataDecoded> | Record<string, string | boolean | Array<string | boolean | PostedDataDecoded>> | Record<string, string | boolean | Array<string | boolean>>>

export type RequestBodyRecordValue = string | Array<RequestBodyRecordValue> | { [key: string]: RequestBodyRecordValue } | { [key: string]: RequestBodyFile } | Array<RequestBodyFile> | RequestBodyFile;

export interface RequestBodyArguments {
    [key: string] : RequestBodyRecordValue,
    [symbolArrays]? : {
        [key: string] : Array<string>
    }
}

export type RequestBodyFiles = {
    [key: string] : RequestBodyFile
}

export type RequestBodyFile = {
    fileName: string,
    data: Buffer,
    type: string
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
    attributes: Record<string, string | null>,
    priority: number
}

export type ComponentEntry = {
    name: string,
    path: {
        absolute: string,
        relative: string,
        relativeToViews: string,
        build: string,
        html: string,
        jsServer?: string,
        jsClient?: string
    },
    hasJS: boolean,
    html : string,

    static: boolean,
    
    // server side component module
    module?: ComponentScaffold,

    // default is "div"
    renderTagName?: string,

    // whether to set data-component-data on rendered component so it's available client side
    exportData: boolean,

    // selectively export data
    exportFields? : Array<string>,

    attributes?: Record<string, string>,
    
    // client side component initializer
    initializer?: InitializerFunction
}

export interface ComponentScaffold  {
    // rendered tag name (default is "div")
    tagName?: string,

    exportData?: boolean,
    // selectively export data
    exportFields? : Array<string>,

    static?: boolean,

    attributes?: Record<string, string>,

    getData: (this: ComponentScaffold, data: RequestBodyArguments|LooseObject, ctx: undefined|RequestContext, app: Application) => Promise<LooseObject | null>
    [key: string] : any
}

export type LooseObject = Record<string, any>

export type ApplicationEvents = 'serverStarted'|'beforeRequestHandler'|'afterRequestHandler'|'beforeRoutes'|'afterRoutes'|'beforeComponentLoad'|'afterComponentLoad'|'documentCreated'|'beforeAssetAccess'|'afterAssetAccess'|'pageNotFound';

export type SessionEntry = {
    sessionId : string,
    lastRequest: number,
    data: LooseObject
}

export type ValidationRuleWithArguments = [string, any];
export type FormValidationEntry = {
    // field_name, human readable name
    field: [string, string],
    rules: Array<string|ValidationRuleWithArguments|ValidatorFunction>
}
export type ValidatorFunction = (data: PostedDataDecoded, field: string, arg: number, rules: Array<string|ValidationRuleWithArguments|ValidatorFunction>) => Promise<boolean>;
export type ValidatorErrorDecorator = (fieldHumanReadable: string, data: PostedDataDecoded, field: string, arg: any) => string;
export type ValidationErrors = {
    [field: string] : Array<string>
}

export type ValidationErrorsSingle = {
    [field: string] : string
}

export type ValidationResult = {
    valid: boolean,
    errors: ValidationErrors|ValidationErrorsSingle
}

export type InitializerFunction = {
    (this: ClientComponent, ctx : InitializerFunctionContext) : void
}

export type Initializers = {
    [key: string] : InitializerFunction
}

export type InitializerFunctionContext = {
    net: Net
}

export type StoreChangeCallback = (key: string, value: any, oldValue: any, componentId: string) => void

export type AsteriskAny = '*';

export type ClientComponentTransition = {
    fade: false|number,
    slide: false|number
}

export type ClientComponentTransitionEvent = 'show' | 'hide';
export type ClientComponentTransitions = Record<ClientComponentTransitionEvent, ClientComponentTransition>;