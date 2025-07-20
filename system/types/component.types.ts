import { ClientComponent } from "../client/ClientComponent.js";
import { Net } from "../client/Net.js";
import { Application } from "../server/Application.js";
import { Component } from "../server/Component.js";
import { LooseObject } from './general.types.js';
import { RequestContext, RequestBodyArguments } from "./request.types.js";

export type ComponentEntry = {
    name: string;
    path: {
        absolute: string;
        relative: string;
        relativeToViews: string;
        build: string;
        html: string;
        jsServer?: string;
        jsClient?: string;
    };
    hasServerPart: boolean;

    // component's server side part class instance
    serverPart?: ComponentScaffold;

    html: string;

    static: boolean;

    // default is "div"
    renderTagName?: string;

    // if true, all component data is exported to ClientComponent
    exportData: boolean;

    // selectively export data to ClientComponent
    exportFields?: Array<string>;

    // attributes added to rendered DOM node
    attributes?: Record<string, string>;

    // client side component initializer
    initializer?: InitializerFunction;
};

export interface ComponentScaffold {
    // rendered tag name (default is "div")
    tagName?: string;

    exportData?: boolean;
    // selectively export data
    exportFields?: Array<string>;

    static?: boolean;
    deferred?: (data: Record<string, any>, ctx: RequestContext | undefined, app: Application) => boolean;

    attributes?: Record<string, string>;

    getData: (this: ComponentScaffold, data: RequestBodyArguments | LooseObject, ctx: undefined | RequestContext, app: Application, component: Component) => Promise<LooseObject | null>;
    [key: string]: any;
}

export type ClientComponentTransition = {
    fade: false | number;
    slide: false | number;
};

export type ClientComponentTransitionEvent = 'show' | 'hide';

export type ClientComponentTransitions = Record<ClientComponentTransitionEvent, ClientComponentTransition>;

export type ClientComponentBoundEvent<T extends LooseObject | undefined = undefined> = {
    element: HTMLElement | Window;
    event: keyof HTMLElementEventMap;
    callback: (e: Event) => void;
    callbackOriginal: ClientComponentEventCallback<T>;
};

export type ClientComponentEventCallback<T> = (e: Event, data: T, element: HTMLElement | Window) => void;

// client side component initializer function
export type InitializerFunction = (this: ClientComponent, ctx: InitializerFunctionContext) => Promise<void>;
export type Initializers = {
    [key: string]: InitializerFunction;
};
export type InitializerFunctionContext = {
    net: Net;
    isRedraw: boolean;
};