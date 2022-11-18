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

    cookies: LooseObject,

    // POSTed data, parsed to object
    body?: RequestBodyArguments,

    bodyRaw?: Buffer,

    // files extracted from request body
    // currently only multipart/form-data
    files?: RequestBodyFiles,

    // user defined data
    data: LooseObject,

    // if session is started and user has visited any page
    sessionId?: string,

    // true if x-requested-with header is received and it equals 'xmlhttprequest'
    isAjax: boolean
}

export type RequestBodyArguments = {
    [key: string] : string
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
    attributes: {
        [propertyName: string] : string|null
    }
    priority: number
}

export type ComponentEntry = {
    name: string,
    path: string,
    hasJS: boolean,
    pathJS?: string,
    module?: any,
    html : string
}

export interface ComponentScaffold  {
    primaryKey: string|number,
    getData(attributeData: RequestBodyArguments): Promise<LooseObject>,
    create?(entry: LooseObject): Promise<any>,
    delete?(id: string): Promise<any>
}

export type LooseObject = {
    [key: string] : any
}

export type ApplicationCallbacks = 'serverStarted'|'beforeRequestHandler'|'afterRequestHandler';

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
export type ValidatorFunction = (data: RequestBodyArguments, field: string, arg: number, rules: Array<string|ValidationRuleWithArguments|ValidatorFunction>) => Promise<boolean>;
export type ValidatorErrorDecorator = (fieldHumanReadable: string, data: RequestBodyArguments, field: string, arg: any) => string;
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