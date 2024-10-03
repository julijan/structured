import { ClientComponentTransition, ClientComponentTransitions, InitializerFunction, LooseObject } from '../Types.js';
import { attributeValueFromString, attributeValueToString, isAsync, mergeDeep, toCamelCase } from '../Util.js';
import { parseBodyURLEncoded } from '../server/Request.js';
import { DataStoreView } from './DataStoreView.js';
import { DataStore } from './DataStore.js';
import { Net } from './Net.js';
import { NetRequest } from './NetRequest.js';


export class ClientComponent {
    readonly name: string;
    children: Array<ClientComponent> = [];
    readonly parent: ClientComponent;
    readonly domNode: HTMLElement;
    readonly isRoot: boolean;
    readonly root: ClientComponent;
    store: DataStoreView;
    private storeGlobal: DataStore;
    private initializerExecuted: boolean = false;

    deleted: boolean = false;

    private redrawRequest: XMLHttpRequest | null = null;

    // optional user defined callbacks
    onDestroy?: Function;
    onRedraw?: Function;

    // callbacks bound using bind method
    private bound: Array<{
        element: HTMLElement;
        event: string;
        callback: (e: Event) => void;
    }> = [];

    private conditionals: Array<HTMLElement> = [];
    private refs: {
        [key: string]: HTMLElement | ClientComponent;
    } = {};
    private refsArray: {
        [key: string]: Array<HTMLElement | ClientComponent>;
    } = {};

    // used for showing/hiding conditionals
    private transitions: ClientComponentTransitions = {
        show: {
            fade: false,
            slide: false
        },
        hide: {
            fade: false,
            slide: false
        }
    };

    // a place for user-defined "methods"
    // executed using run method
    // these should be arrow functions in order to keep the context
    private callbacks: {
        [key: string]: Function;
    } = {};

    private loaded: boolean;

    // callback executed each time the component is redrawn
    // this is the ideal place for binding any event listeners within component
    private initializer: InitializerFunction | null = null;

    // data-attr are parsed into an object
    private data: {
        [key: string]: any;
    } = {};

    private dataAttributes: {
        [key: string]: string;
    } = {};

    constructor(parent: ClientComponent | null, name: string, domNode: HTMLElement, store: DataStore) {
        this.name = name;
        this.domNode = domNode;
        if (parent === null) {
            this.isRoot = true;
            this.root = this;
            this.parent = this;
        } else {
            this.isRoot = false;
            this.root = parent.root;
            this.parent = parent;
        }

        this.store = new DataStoreView(store, this);

        this.initRefs();
        this.initData();
        this.initModels();

        this.storeGlobal = store;

        this.initConditionals();
        this.initChildren(this.domNode, this);

        this.loaded = !this.data.if;

        // update conditionals as soon as component is initialized
        if (this.conditionals.length > 0) {
            this.updateConditionals(false);
        }

        // update conditionals whenever any data in component's store has changed
        this.store.onChange('*', function () {
            this.updateConditionals(true);
        });

        this.promoteRefs();

        // @ts-ignore
        if (initializers && initializers[this.name]) {
            // @ts-ignore
            this.init(initializers[this.name]);
        }
    }

    // set initializer callback and execute it
    private init(initializer: InitializerFunction | string) {
        if (! this.initializerExecuted) {
            let initializerFunction: InitializerFunction | null = null;
            if (typeof initializer === 'string') {
                initializerFunction = new Function('const init = ' + initializer + '; init.apply(this, [...arguments]);') as InitializerFunction;
            } else {
                initializerFunction = initializer;
            }

            if (initializerFunction) {
                this.initializer = initializerFunction;
                this.initializer.apply(this, [{
                    net: new Net()
                }]);
            }
        }
        this.initializerExecuted = true;
    }

    // parse all data-attr attributes into this.data object converting the data-attr to camelCase
    private initData(): void {
        for (let i = 0; i < this.domNode.attributes.length; i++) {

            // store original attributes
            this.dataAttributes[this.domNode.attributes[i].name] = this.domNode.attributes[i].value;

            // data-attr, convert to dataAttr and store value
            // if (this.domNode.attributes[i].name.indexOf('data-') === 0) {
            if (/^((number|string|boolean|object|any):)?data-[^\s]+/.test(this.domNode.attributes[i].name)) {
                const value = this.domNode.attributes[i].value;
                const attrData = attributeValueFromString(value);

                if (typeof attrData === 'object') {
                    // this.data[attrData.key] = attrData.value;
                    this.set(attrData.key, attrData.value);
                } else {
                    // not a valid attribute data string, assign as is (string)
                    const key = toCamelCase(this.domNode.attributes[i].name.substring(5));
                    // this.data[key] = attrData;
                    this.set(key, attrData);
                }
            }
        }
    }

    // array of attribute data all the way up to root, or the first component with no dependencies (no data-use attribute)
    // used for redraw
    public pathData(): Array<{
        [key: string]: string;
    }> {
        let current: ClientComponent = this;
        const data = [];
        do {
            data.push(current.data);
            if (current.isRoot || !current.data.use) {
                break;
            }
            current = current.parent;
        } while (true);
        return data.reverse();
    }

    // set a data value (data-attr)
    public set(key: string, value: any) {

        if (typeof key !== 'string') {return;}

        const dataKey = 'data-' + key;

        const val = attributeValueToString(key, value);
        this.domNode.setAttribute(dataKey, val);
        this.dataAttributes[dataKey] = val;
        this.data[toCamelCase(key)] = value;
        this.store.set(key, value);
    }

    private initChildren(scope?: HTMLElement, parent?: ClientComponent): void {

        if (scope === undefined) {
            scope = this.domNode;
        }

        for (let i = 0; i < scope.childNodes.length; i++) {
            const childNode = scope.childNodes[i];
            if (childNode.nodeType == 1) {
                if ((childNode as HTMLElement).hasAttribute('data-component')) {
                    // found a child component, add to children
                    this.children.push(new ClientComponent(parent || null, (childNode as HTMLElement).getAttribute('data-component') || '', childNode as HTMLElement, this.storeGlobal));
                } else {
                    // not a component, resume from here recursively
                    this.initChildren((childNode as HTMLElement), this);
                }
            }
        }
    }

    // fetch from server and replace with new HTML
    // optionally can provide data that the component will receive when rendering
    public async redraw(data?: LooseObject): Promise<void> {

        data = (data ? mergeDeep({}, data) : {}) as LooseObject;
        // we delete componentId from data to allow passing entire componentData to child
        // without overwriting it's id
        delete data.componentId;

        // abort existing redraw call, if in progress
        if (this.redrawRequest !== null) {
            this.redrawRequest.abort();
            this.redrawRequest = null;
        }

        if (typeof this.onRedraw === 'function') {
            this.run(this.onRedraw);
        }

        this.loaded = false;

        data = mergeDeep(data, this.data) as LooseObject;

        const redrawRequest = new NetRequest('POST', '/componentRender', {
            'content-type': 'application/json'
        });
        this.redrawRequest = redrawRequest.xhr;

        const componentDataJSON = await redrawRequest.send(JSON.stringify({
            component: this.name,
            attributes: data
        }));

        // should only happen if a previous redraw attempt was aborted
        if (componentDataJSON.length === 0) { return; }

        const componentData: {
            html: string;
            initializers: Record<string, string>;
            data: LooseObject;
        } = JSON.parse(componentDataJSON);

        this.redrawRequest = null;

        for (const key in componentData.data) {
            this.set(key, componentData.data[key]);
            this.store.set(key, componentData.data[key]);
        }

        // add any new initializers to global initializers list
        for (const key in componentData.initializers) {
            // @ts-ignore
            if (!initializers[key]) {
                console.log('registering initializer', key);
                // @ts-ignore
                initializers[key] = componentData.initializers[key];
                if (this.name === key) {
                    this.init(componentData.initializers[key] as string);
                }
            }
        }
        this.domNode.innerHTML = componentData.html;


        // re-init children because their associated domNode is no longer part of the DOM
        // component initializers will get lost
        this.children = [];
        this.initChildren(this.domNode, this);

        // re-init conditionals and refs
        this.refs = {};
        this.refsArray = {};
        this.conditionals = [];
        this.initRefs();
        this.initModels();
        this.initConditionals();
        this.updateConditionals(false);

        // run the initializer
        if (this.initializer && ! this.initializerExecuted) {
            this.initializer.apply(this, [{
                net: new Net()
            }]);
        }

        this.loaded = true;
    }

    private initConditionals(node?: HTMLElement): void {
        const isSelf = node === undefined;
        if (node === undefined) {
            node = this.domNode;
        }

        if (node.hasAttribute('data-if')) {
            this.conditionals.push(node);
        }

        node.childNodes.forEach((child) => {
            if (child.nodeType === 1 && (isSelf || !node?.hasAttribute('data-component'))) {
                this.initConditionals(child as HTMLElement);
            }
        });
    }

    private initRefs(node?: HTMLElement): void {
        const isSelf = node === undefined;
        if (node === undefined) {
            node = this.domNode;
        }

        if (node.hasAttribute('ref')) {
            this.refs[node.getAttribute('ref') || 'undefined'] = node;
        }

        if (node.hasAttribute('array:ref')) {
            const key = node.getAttribute('array:ref') || 'undefined';
            if (!(key in this.refsArray)) {
                this.refsArray[key] = [];
            }
            this.refsArray[key].push(node);
        }

        node.childNodes.forEach((child) => {
            if (child.nodeType === 1 && (isSelf || !node?.hasAttribute('data-component'))) {
                this.initRefs(child as HTMLElement);
            }
        });
    }

    // make inputs with data-model="field" work
    // nested data works too, data-model="obj[nested][key]" or data-model="obj[nested][key][]"
    private initModels(node?: HTMLElement) {
        const isSelf = node === undefined;
        if (node === undefined) {
            node = this.domNode;
        }


        if (node.hasAttribute('data-model') && (node.tagName === 'INPUT' || node.tagName === 'SELECT' || node.tagName === 'TEXTAREA')) {
            const field = node.getAttribute('data-model');
            if (field) {
                node.addEventListener('input', () => {
                    const value = parseBodyURLEncoded(`${field}=${(node as HTMLInputElement).value}`);
                    const key = Object.keys(value)[0];
                    this.set(key || 'undefined', mergeDeep(this.componentData(key) || {}, value[key]));
                });
            }
        }

        node.childNodes.forEach((child) => {
            if (child.nodeType === 1 && (isSelf || !node?.hasAttribute('data-component'))) {
                this.initModels(child as HTMLElement);
            }
        });
    }

    private promoteRefs() {
        this.children.forEach((child) => {
            const ref = child.domNode.getAttribute('ref');
            if (ref) {
                console.log('ref promoted');
                this.refs[ref] = child;
            }
        });
    }

    public ref<T>(refName: string): T {
        return this.refs[refName] as T;
    }

    public refArray<T>(refName: string): Array<T> {
        return (this.refsArray[refName] || []) as Array<T>;
    }

    private updateConditionals(enableTransition: boolean) {
        this.conditionals.forEach((node) => {
            let condition = node.getAttribute('data-if') as string;
            let show: any = false;

            const negated = condition?.indexOf('!') === 0;
            if (negated) {
                const conditionMatch = /^!\s*(.*?)$/.exec(condition);
                if (conditionMatch) {
                    condition = conditionMatch[1];
                }
            }

            if (condition) {
                if (condition.endsWith('()')) {
                    // method
                    // try calling this.[condition]()
                    // it should return a boolean
                    const prop = this[condition as keyof ClientComponent];
                    const propType = typeof prop;
                    if (propType !== 'undefined') {
                        if (propType === 'function') {
                            // @ts-ignore
                            show = prop();
                        } else {
                            show = prop;
                        }
                    } else {
                        console.warn(`${this.name}, data-if=${condition}, ${condition} does not exist as a property/method on this component`);
                    }
                } else {
                    // prop from components state
                    show = this.store.get(condition);
                }

                if (negated) {
                    show = !show;
                }

                if (show == true) {
                    if (node.getAttribute('data-component')) {
                        const conditionalChild = this.children.find((child) => {
                            return child.domNode === node;
                        });
                        if (conditionalChild) {
                            if (!conditionalChild.loaded) {
                                // conditional child not yet loaded
                                conditionalChild.redraw();
                                conditionalChild.domNode.style.display = '';
                            }
                        }
                    }
                    // node.style.display = '';
                    this.show(node, enableTransition);
                } else {
                    // node.style.display = 'none';
                    this.hide(node, enableTransition);
                }
            }
        });
    }

    // remove the DOM node and delete from parent.children effectively removing self from the tree
    // the method could be sync, but since we want to allow for potentially async user destructors
    // it is async
    public async remove() {
        if (!this.isRoot) {

            this.deleted = true;

            // remove children recursively
            const children = Array.from(this.children);
            for (let i = 0; i < children.length; i++) {
                await children[i].remove();
            }

            // call user defined destructor
            await this.destroy();

            // remove node
            this.domNode.parentElement?.removeChild(this.domNode);

            // remove from parent's children array
            if (this.parent) {
                this.parent.children.splice(this.parent.children.indexOf(this), 1);
            }
        }
    }

    // travel up the tree until a parent with given parentName is found
    // if no such parent is found returns null
    public parentFind(parentName: string): ClientComponent | null {
        let parent = this.parent;
        while (true) {
            if (parent.name === parentName) {
                return parent;
            }

            if (parent.isRoot) {
                break;
            }

            parent = parent.parent;
        }

        return null;
    }

    // find another component within this component recursively, returns the first found component with given name
    public find(componentName: string): null | ClientComponent {
        for (let i = 0; i < this.children.length; i++) {
            const child = this.children[i];
            if (child.name == componentName) {
                // found it
                return child;
            } else {
                // search recursively, if found return
                const inChild = child.find(componentName);
                if (inChild) {
                    return inChild;
                }
            }
        }
        return null;
    }

    // find another component within this component recursively, returns all found components with given name
    public query(componentName: string, results: Array<ClientComponent> = []): Array<ClientComponent> {
        for (let i = 0; i < this.children.length; i++) {
            const child = this.children[i];
            if (child.name == componentName) {
                // found it
                results.push(child);
            } else {
                // search recursively, if found return
                child.query(componentName, results);
            }
        }
        return results;
    }

    // append to is a selector within this component's dom
    public async add(appendTo: string | HTMLElement | Element, componentName: string, data?: LooseObject, attributes?: { [key: string]: string; }): Promise<ClientComponent | null> {
        const container = typeof appendTo === 'string' ? this.domNode.querySelector(appendTo) : appendTo;

        if (container === null) {
            console.warn(`${this.name}.add() - appendTo selector not found within this component`);
            return null;
        }


        const req = new NetRequest('POST', '/componentRender', {
            'content-type': 'application/json'
        });

        const componentDataJSON = await req.send(JSON.stringify({
            component: componentName,
            attributes: data
        }));

        const res: {
            html: string;
            initializers: Record<string, string>;
            data: LooseObject;
        } = JSON.parse(componentDataJSON);

        // add any new initializers to global initializers list
        for (let key in res.initializers) {
            // @ts-ignore
            if (!initializers[key]) {
                console.log('registering initializer', key);
                // @ts-ignore
                initializers[key] = res.initializers[key];
                if (this.name === key) {
                    this.init(res.initializers[key] as string);
                }
            }
        }

        const tmpContainer = document.createElement('div');
        tmpContainer.innerHTML = res.html;

        const componentNode = tmpContainer.firstChild as HTMLElement;

        const component = new ClientComponent(this, componentName, componentNode, this.storeGlobal);
        this.children.push(component);

        container.appendChild(componentNode);

        return component;
    }

    public componentData<T>(key?: string): T {
        if (!key) {
            return this.data as T;
        }
        return this.data[key] as T;
    }

    public setTransition(action: keyof ClientComponentTransitions, transition: keyof ClientComponentTransition, durationMs: false | number): void {
        this.transitions[action][transition] = durationMs;
    }

    public show(domNode: HTMLElement, enableTransition: boolean) {
        if (!enableTransition) {
            domNode.style.display = '';
            return;
        }

        if (domNode.style.display !== 'none') { return false; }

        // const transitions = this.transitions.show;
        const transitions = this.transitionAttributes(domNode).show;

        const transitionsActive = Object.keys(transitions).filter((key: keyof ClientComponentTransition) => {
            return transitions[key] !== false;
        }).reduce((prev, curr) => {
            const key = curr as keyof ClientComponentTransition;
            prev[key] = transitions[key];
            return prev;
        }, {} as {
            [key in keyof ClientComponentTransition]: false | number;
        });

        if (Object.keys(transitionsActive).length === 0) {
            domNode.style.display = '';
            return;
        }

        domNode.style.display = '';

        const onTransitionEnd = (e: any) => {
            domNode.style.opacity = '1';
            domNode.style.transition = '';
            domNode.style.transformOrigin = 'unset';
            domNode.removeEventListener('transitionend', onTransitionEnd);
            domNode.removeEventListener('transitioncancel', onTransitionEnd);
        };

        domNode.addEventListener('transitionend', onTransitionEnd);
        domNode.addEventListener('transitioncancel', onTransitionEnd);

        if (transitionsActive.slide) {

            // if specified use given transformOrigin
            const transformOrigin = domNode.getAttribute('data-transform-origin-show') || '50% 0';

            domNode.style.transformOrigin = transformOrigin;
            const axis = this.transitionAxis(domNode, 'show');
            domNode.style.transform = `scale${axis}(0.01)`;
            domNode.style.transition = `transform ${transitionsActive.slide / 1000}s`;
            setTimeout(() => {
                // domNode.style.height = height + 'px';
                domNode.style.transform = `scale${axis}(1)`;
            }, 100);
        }

        if (transitionsActive.fade) {
            domNode.style.opacity = '0';
            domNode.style.transition = `opacity ${transitionsActive.fade / 1000}s`;
            setTimeout(() => {
                domNode.style.opacity = '1';
            }, 100);
        }

    }

    public hide(domNode: HTMLElement, enableTransition: boolean) {
        if (!enableTransition) {
            domNode.style.display = 'none';
            return;
        }

        if (domNode.style.display === 'none') { return false; }

        // const transitions = this.transitions.hide;
        const transitions = this.transitionAttributes(domNode).hide;

        const transitionsActive = Object.keys(transitions).filter((key: keyof ClientComponentTransition) => {
            return transitions[key] !== false;
        }).reduce((prev, curr) => {
            const key = curr as keyof ClientComponentTransition;
            prev[key] = transitions[key];
            return prev;
        }, {} as {
            [key in keyof ClientComponentTransition]: false | number;
        });

        if (Object.keys(transitionsActive).length === 0) {
            // no transitions
            domNode.style.display = 'none';
        } else {

            const onTransitionEnd = (e: any) => {
                domNode.style.display = 'none';
                domNode.style.opacity = '1';
                domNode.style.transition = '';
                domNode.style.transformOrigin = 'unset';
                domNode.removeEventListener('transitionend', onTransitionEnd);
                domNode.removeEventListener('transitioncancel', onTransitionEnd);
            };

            domNode.addEventListener('transitionend', onTransitionEnd);
            domNode.addEventListener('transitioncancel', onTransitionEnd);

            if (transitionsActive.slide) {
                // domNode.style.overflowY = 'hidden';
                // domNode.style.height = domNode.clientHeight + 'px';
                // if specified use given transformOrigin
                const transformOrigin = domNode.getAttribute('data-transform-origin-hide') || '50% 100%';

                domNode.style.transformOrigin = transformOrigin;
                domNode.style.transition = `transform ${transitionsActive.slide / 1000}s ease`;
                setTimeout(() => {
                    // domNode.style.height = '2px';
                    const axis = this.transitionAxis(domNode, 'hide');
                    domNode.style.transform = `scale${axis}(0.01)`;
                }, 100);
            }

            if (transitionsActive.fade) {
                domNode.style.opacity = '1';
                domNode.style.transition = `opacity ${transitionsActive.fade / 1000}s`;
                setTimeout(() => {
                    domNode.style.opacity = '0';
                }, 100);
            }

        }

    }

    private transitionAttributes(domNode: HTMLElement): ClientComponentTransitions {
        const transitions: ClientComponentTransitions = {
            show: {
                slide: false,
                fade: false
            },
            hide: {
                slide: false,
                fade: false
            }
        };

        for (const action in transitions) {
            for (const transition in transitions[action as keyof ClientComponentTransitions]) {
                const attrName = `data-transition-${action}-${transition}`;
                if (domNode.hasAttribute(attrName)) {
                    transitions[action as keyof ClientComponentTransitions][transition as keyof ClientComponentTransition] = parseInt(domNode.getAttribute(attrName) || '0');
                }
            }
        }

        return transitions;
    }

    private transitionAxis(domNode: HTMLElement, showHide: 'show' | 'hide'): 'X' | 'Y' | '' {
        const key = `data-transition-axis-${showHide}`;
        let val = domNode.getAttribute(key);
        if (typeof val === 'string') {
            val = val.toUpperCase();
            if (val.length > 0) {
                val = val.substring(0, 1);
            }

            if (val != 'X' && val != 'Y') {
                // unrecognized value
                return '';
            }

            return val;
        }
        return '';
    }

    // run a user defined callback
    async run<T>(callbackNameOrFn: string | Function, args: Array<any> = []): Promise<T | undefined> {
        let fn = callbackNameOrFn;

        if (typeof fn === 'string') {
            fn = this.callbacks[fn];
        }

        if (typeof fn === 'function') {
            if (isAsync(fn)) {
                return await fn(...args) as T;
            } else {
                return fn(...args) as T;
            }
        }
        // calback not defined
        console.error(`Callback ${callbackNameOrFn} is not defined`);
        return undefined;
    }

    private async destroy(): Promise<void> {
        this.unbindAll();
        // if the user has defined a destroy callback, run it
        if (typeof this.onDestroy === 'function') {
            await this.run(this.onDestroy);
        }
    }

    public bind(element: HTMLElement | undefined | null, event: string, callback: (e: Event) => void) {
        if (element instanceof HTMLElement) {
            this.bound.push({
                element,
                event,
                callback
            });
            element.addEventListener(event, callback);
        }
    }

    private unbindAll() {
        this.bound.forEach((bound) => {
            bound.element.removeEventListener(bound.event, bound.callback);
        });
    }

}
