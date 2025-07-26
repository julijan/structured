import { ClientComponent } from "../client/ClientComponent.js";
import { Net } from "../client/Net.js";
import { Application } from "../server/Application.js";
import { Component } from "../server/Component.js";
import { EventEmitterCallback } from "./eventEmitter.types.js";
import { KeysOfUnion, LooseObject } from './general.types.js';
import { RequestContext } from "./request.types.js";

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
    exportFields?: ReadonlyArray<string>;

    // attributes added to rendered DOM node
    attributes?: Record<string, string>;

    // client side component initializer
    initializer?: InitializerFunction;
};

export interface ComponentScaffold<T extends LooseObject = LooseObject, K extends KeysOfUnion<T> = KeysOfUnion<T>> {
    // rendered tag name (default is "div")
    tagName?: string;

    // export all data if true
    exportData?: boolean;

    // selectively export data
    exportFields?: ReadonlyArray<K>;

    static?: boolean;
    deferred?: (data: Record<string, any>, ctx: RequestContext | undefined, app: Application) => boolean;

    attributes?: Record<string, string>;

    getData: (this: ComponentScaffold, data: LooseObject, ctx: undefined | RequestContext, app: Application, component: Component) => Promise<T | void>;
    [key: string]: any;
}

export type ClientComponentTransition = {
    fade: false | number;
    slide: false | number;
    grow: false | number;
};

export type ClientComponentTransitionEvent = 'show' | 'hide';

export type ClientComponentTransitions = Record<ClientComponentTransitionEvent, ClientComponentTransition>;

export type ClientComponentBoundEvent<T extends LooseObject | undefined, E extends HTMLElement | Window | ClientComponent> = {
    element: E;
    event: keyof HTMLElementEventMap;
    callback: E extends ClientComponent ? EventEmitterCallback<T> : (e: Event) => void;
    callbackOriginal: E extends ClientComponent ? EventEmitterCallback<T> : ClientComponentEventCallback<T>;
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