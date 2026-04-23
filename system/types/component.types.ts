import { ClientComponent } from "../client/ClientComponent.js";
import { Net } from "../client/Net.js";
import { Application } from "../server/Application.js";
import { Component } from "../server/Component.js";
import { RequestContext } from "../server/RequestContext.js";
import { EventEmitterCallback } from "./eventEmitter.types.js";
import { KeysOfUnion, LooseObject } from './general.types.js';

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

export interface ComponentScaffold<I extends LooseObject = LooseObject, O extends LooseObject = LooseObject, K extends KeysOfUnion<O> = KeysOfUnion<O>> {
    // rendered tag name (default is "div")
    tagName?: string;

    // export all data if true
    exportData?: boolean;

    // selectively export data
    exportFields?: ReadonlyArray<K>;

    static?: boolean;
    deferred?: (data: Record<string, any>, ctx: RequestContext, app: Application) => boolean;

    attributes?: Record<string, string>;

    getData: (this: ComponentScaffold<I, O>, data: I, ctx: RequestContext, app: Application, component: Component) => Promise<O | void>;
}

// event -> payload
export type ComponentEvents = {
    componentCreated : Component,
    ready: undefined,
}

export type ClientComponentTransition = {
    fade: false | number;
    slide: false | number;
    grow: false | number;
};

export type ClientComponentTransitionEvent = 'show' | 'hide';

export type ClientComponentTransitions = Record<ClientComponentTransitionEvent, ClientComponentTransition>;

export type ClientComponentBoundEvent<Data extends LooseObject | undefined, Element extends HTMLElement | Window | ClientComponent, Evt extends Event = Event> = {
    element: Element;
    event: keyof HTMLElementEventMap;
    callback: Element extends ClientComponent ? EventEmitterCallback<Data> : (e: Event) => void;
    callbackOriginal: Element extends ClientComponent ? EventEmitterCallback<Data> : ClientComponentEventCallback<Data, Evt>;
};

export type ClientComponentEventCallback<T, E extends Event = Event> = (e: E, data: T, element: HTMLElement | Window) => void;

// client side component initializer function
export type InitializerFunction = (this: ClientComponent, ctx: InitializerFunctionContext) => Promise<void>;
export type Initializers = {
    [key: string]: InitializerFunction;
};
export type InitializerFunctionContext = {
    net: Net;
    isRedraw: boolean;
};