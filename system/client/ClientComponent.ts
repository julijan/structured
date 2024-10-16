import { ClientComponentTransition, ClientComponentTransitions, InitializerFunction, LooseObject, StoreChangeCallback } from '../Types.js';
import { attributeValueFromString, attributeValueToString, mergeDeep, objectEach, queryStringDecodedSetValue, toCamelCase } from '../Util.js';
import { DataStoreView } from './DataStoreView.js';
import { DataStore } from './DataStore.js';
import { Net } from './Net.js';
import { NetRequest } from './NetRequest.js';

// window.initializers will always be present
// each Document has a list of initializers used in components within it
// and they will be output as initializers = { componentName : initializer }
declare global {
    interface Window {
        initializers: Record<string, InitializerFunction | string>;
    }
}

export class ClientComponent {
    readonly name: string;
    children: Array<ClientComponent> = [];
    readonly parent: ClientComponent;
    readonly domNode: HTMLElement;
    readonly isRoot: boolean;
    readonly root: ClientComponent;
    store: DataStoreView;
    private storeGlobal: DataStore;
    readonly net: Net = new Net();
    private initializerExecuted: boolean = false;

    destroyed: boolean = false;

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

    // DOM elements within the component that have a data-if attribute
    private conditionals: Array<HTMLElement> = [];

    // available for use in data-if and data-classname-[className]
    private conditionalCallbacks: Record<string, (args?: any) => boolean> = {};

    private conditionalClassNames: Array<{
        element: HTMLElement,
        className: string
    }> = [];

    private refs: {
        [key: string]: HTMLElement | ClientComponent;
    } = {};
    private refsArray: {
        [key: string]: Array<HTMLElement | ClientComponent>;
    } = {};

    loaded: boolean;

    // callback executed each time the component is redrawn
    // this is the ideal place for binding any event listeners within component
    private initializer: InitializerFunction | null = null;

    // data-attr are parsed into an object
    private data: {
        [key: string]: any;
    } = {};

    constructor(parent: ClientComponent | null, name: string, domNode: HTMLElement, store: DataStore, autoInit: boolean = true) {
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

        this.storeGlobal = store;
        this.store = new DataStoreView(this.storeGlobal, this);

        this.initRefs();
        this.initData();
        this.initModels();
        this.initConditionals();
        this.initChildren(this.domNode, this);
        this.promoteRefs();

        // update conditionals whenever any data in component's store has changed
        this.store.onChange('*', () => {
            this.updateConditionals(true);
        });

        // run initializer, if one exists for current component
        // if autoInit = false component will not be automatically initialized
        if (autoInit && window.initializers !== undefined && this.name in window.initializers) {
            this.init();
        }

        // update conditionals as soon as component is initialized
        if (this.conditionals.length > 0) {
            this.updateConditionals(false);
        }

        // deferred component, redraw it immediately
        if (this.data.deferred === true) {
            this.loaded = false;
            this.setData('deferred', false, false);
            this.redraw();
        } else {
            this.loaded = true;
        }
    }

    // set initializer callback and execute it
    private init(isRedraw: boolean = false) {
        const initializer = window.initializers[this.name];
        if (! initializer) {return;}
        if (! this.initializerExecuted && ! this.destroyed) {
            let initializerFunction: InitializerFunction | null = null;
            if (typeof initializer === 'string') {
                initializerFunction = new Function('const init = ' + initializer + '; init.apply(this, [...arguments]);') as InitializerFunction;
            } else {
                initializerFunction = initializer;
            }

            if (initializerFunction) {
                this.initializer = initializerFunction;
                this.initializer.apply(this, [{
                    net: this.net,
                    isRedraw
                }]);
            }
        }
        this.initializerExecuted = true;
    }

    // parse all data-[key] attributes found on this.domNode into this.data object
    // key converted to camelCase
    // values are expected to be encoded using attributeValueToString
    // and will be decoded using attributeValueFromString
    private initData(): void {
        for (let i = 0; i < this.domNode.attributes.length; i++) {
            // data-attr, convert to dataAttr and store value
            if (/^((number|string|boolean|object|any):)?data-[^\s]+/.test(this.domNode.attributes[i].name)) {
                const value = this.domNode.attributes[i].value;
                const attrData = attributeValueFromString(value);

                if (typeof attrData === 'object') {
                    this.setData(attrData.key, attrData.value, false);
                } else {
                    // not a valid attribute data string, assign as is (string)
                    const key = toCamelCase(this.domNode.attributes[i].name.substring(5));
                    this.setData(key, attrData, false);
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

    // sets this.data[key] and optionally this.store[key], key is passed through toCamelCase
    // sets data-[key]="value" attribute on this.domNode, value passed through attributeValueToString
    // if updateStore is true (default) value is also applied to this.store
    // returns this to allow chaining
    public setData(key: string, value: any, updateStore: boolean = true): ClientComponent {
        const dataKey = `data-${key}`;
        this.domNode.setAttribute(dataKey, attributeValueToString(key, value));
        const keyCamelCase = toCamelCase(key);
        this.data[keyCamelCase] = value;
        if (updateStore) {
            this.store.set(keyCamelCase, value);
        }
        return this;
    }

    // find all DOM nodes with data-component attribute within this component,
    // instantiate a ClientComponent with them and add them to this.children
    // if callback is a function, for each instantiated child
    // callback is executed with child as first argument
    private initChildren(scope?: HTMLElement, parent?: ClientComponent, callback?: (component: ClientComponent) => void, autoInit: boolean = true): void {
        if (scope === undefined) {
            scope = this.domNode;
        }

        for (let i = 0; i < scope.childNodes.length; i++) {
            const childNode = scope.childNodes[i];
            if (childNode.nodeType == 1) {
                if ((childNode as HTMLElement).hasAttribute('data-component')) {
                    // found a child component, add to children
                    const component = new ClientComponent(parent || null, (childNode as HTMLElement).getAttribute('data-component') || '', childNode as HTMLElement, this.storeGlobal, autoInit);
                    if (typeof callback === 'function') {
                        callback(component);
                    }
                    this.children.push(component);
                } else {
                    // not a component, resume from here recursively
                    this.initChildren((childNode as HTMLElement), parent, callback);
                }
            }
        }
    }

    // fetch from server and replace with new HTML
    // if data is provided, each key will be set on component using this.setData
    // and as such, component will receive it when rendering
    public async redraw(data?: LooseObject): Promise<void> {
        if (this.destroyed) {return;}

        // set data if provided
        if (data) {
            objectEach(data, (key, val) => {
                this.setData(key, val, false);
            });
        }

        // abort existing redraw call, if in progress
        if (this.redrawRequest !== null) {
            this.redrawRequest.abort();
            this.redrawRequest = null;
        }

        // request a component to be re-rendered on the server
        // unwrap = true so that component container is excluded
        // this component already has it's own container and we only care about what changed within it
        const redrawRequest = new NetRequest('POST', '/componentRender', {
            'content-type': 'application/json'
        });
        this.redrawRequest = redrawRequest.xhr;
        const componentDataJSON = await redrawRequest.send(JSON.stringify({
            component: this.name,
            attributes: this.data,
            unwrap: true
        }));
        // clear redraw request as the request is executed and does not need to be cancelled
        // in case component gets redrawn again
        this.redrawRequest = null;

        // should only happen if a previous redraw attempt was aborted
        if (componentDataJSON.length === 0) { return; }

        // mark component as not loaded
        this.loaded = false;

        // if user has defined onRedraw callback, run it
        if (typeof this.onRedraw === 'function') {
            this.onRedraw.apply(this)
        }

        // remove all bound event listeners as DOM will get replaced in the process
        this.unbindAll();

        const componentData: {
            html: string;
            initializers: Record<string, string>;
            data: LooseObject;
        } = JSON.parse(componentDataJSON);

        // populate this.domNode with new HTML
        this.domNode.innerHTML = componentData.html;

        // apply new data received from the server as it may have changed
        // only exported data is included here
        objectEach(componentData.data, (key, val) => {
            this.setData(key, val, false);
        });

        // add any new initializers to global initializers list
        for (const key in componentData.initializers) {
            if (!window.initializers[key]) {
                window.initializers[key] = componentData.initializers[key];
            }
        }

        // destroy existing children as their associated domNode is no longer part of the DOM
        // new children will be initialized based on the new DOM
        // new DOM may contain same children (same componentId) however by destroying the children
        // any store change listeners will be lost, before destroying each child
        // keep a copy of the store change listeners, which we'll use later to restore those listeners
        const childStoreChangeCallbacks: Record<string, Record<string, Array<StoreChangeCallback>>> = {}
        Array.from(this.children).forEach((child) => {
            childStoreChangeCallbacks[child.getData<string>('componentId')] = child.store.onChangeCallbacks();
            child.destroy();
        });

        // init new children, restoring their store change listeners in the process
        this.initChildren(this.domNode, this, (childNew) => {
            const childNewId = childNew.getData<string>('componentId');
            const existingChild = childNewId in childStoreChangeCallbacks;
            if (existingChild) {
                // child existed before redraw, re-apply onChange callbacks
                objectEach(childStoreChangeCallbacks[childNewId], (key, callbacks) => {
                    callbacks.forEach((callback) => {
                        childNew.store.onChange(key, callback);
                    });
                });
            }

            // idea was that existing child nodes would be initialized with isRedraw = true
            // however after giving it some thought - probably not desirable
            // the whole idea with isRedraw is to inform the initializer whether it's
            // a fresh instance of ClientComponent or an existing one
            // while child (even existing ones) are technically redrawn in this case,
            // they do get a fresh instance of a ClientComponent, hence isRedraw = true would be misleading
            // keeping this comment here in case in the future a need arises to inform children
            // they were redrawn as a consequence of parent redraw
            // if ever done, make sure to set 4th argument of initChildren to false (disabling autoInit)
            // childNew.init(existingChild);
        });

        // re-init conditionals and refs
        this.refs = {};
        this.refsArray = {};
        this.conditionals = [];
        this.initRefs();
        this.initModels();
        this.initConditionals();
        this.promoteRefs();

        // run the initializer
        if (this.initializer) {
            this.initializerExecuted = false;
            this.init(true);
        }

        this.updateConditionals(false);

        // mark component as loaded
        this.loaded = true;
    }

    // populates conditionals and conditionalClassNames
    // these react to changes to store data
    // to show/hide elements or apply/remove class names to/from them
    private initConditionals(node?: HTMLElement): void {
        const isSelf = node === undefined;
        if (node === undefined) {
            node = this.domNode;
        }

        for (const attribute of node.attributes) {
            // data-if
            if (attribute.name === 'data-if') {
                this.conditionals.push(node);
            }

            // data-classname-[className]
            if (attribute.name.startsWith('data-classname')) {
                const className = attribute.name.substring(15);
                this.conditionalClassNames.push({
                    element: node,
                    className
                });
            }
        }

        node.childNodes.forEach((child) => {
            if (child.nodeType === 1 && (isSelf || !node?.hasAttribute('data-component'))) {
                this.initConditionals(child as HTMLElement);
            }
        });
    }

    // initialize refs and refsArray within this component
    // ref="refName"
    // any DOM nodes with attribute ref="refName" will be stored under refs as { refName: HTMLElement }
    // and can be returned using the ref method, refName should be unique,
    // if multiple DOM nodes have the same refName, only the last one will be kept
    // if ref is on a component tag, that ref will get promoted to ClientComponent
    // array:ref="refName"
    // any DOM nodes with attribute array:ref="refName" will be grouped
    // under refsArray as { refName: Array<HTMLElement> } and can be returned using refArray method
    // in contrast to ref, array:ref's refName does not need to be unique, in fact, since it's used
    // to group as set of DOM nodes, it only makes sense if multiple DOM nodes share the same refName
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
    private initModels(node?: HTMLElement, modelNodes: Array<HTMLInputElement> = []) {
        const isSelf = node === undefined;
        if (node === undefined) {
            node = this.domNode;
        }

        // given a HTMLInput element that has data-model attribute, returns an object with the data
        // for example:
        // data-model="name" may result with { name: "John" }
        // data-model="user[name]" may result with { user: { name: "John" } }
        const modelData = (node: HTMLInputElement): LooseObject => {
            const field = node.getAttribute('data-model');
            if (field) {
                const isCheckbox = node.tagName === 'INPUT' && node.type === 'checkbox';
                const valueRaw = isCheckbox ? node.checked : node.value;
                const value = queryStringDecodedSetValue(field, valueRaw);
                return value;
            }
            return {}
        }

        // given a loose object, sets all keys with corresponding value on current component
        const update = (data: LooseObject) => {
            objectEach(data, (key, val) => {
                this.store.set(key, val);
            });
        }

        if (node.hasAttribute('data-model') && (node.tagName === 'INPUT' || node.tagName === 'SELECT' || node.tagName === 'TEXTAREA')) {
            // found a model node, store to array modelNodes
            modelNodes.push(node as HTMLInputElement);
        } else {
            // not a model, but may contain models
            // init model nodes recursively from here
            node.childNodes.forEach((child) => {
                if (child.nodeType === 1 && (isSelf || !node?.hasAttribute('data-component'))) {
                    this.initModels(child as HTMLElement, modelNodes);
                }
            });
        }

        if (isSelf) {
            // all model nodes are now contained in modelNodes array

            // data for the initial update, we want to gather all data up in one object
            // so that nested keys don't trigger more updates than necessary
            let data: LooseObject = {}
            modelNodes.forEach((modelNode) => {
                // on change, update component data
                modelNode.addEventListener('input', () => {
                    let data = modelData(modelNode);
                    const key = Object.keys(data)[0];
                    if (typeof data[key] === 'object') {
                        const dataExisting = this.store.get<LooseObject>(key);
                        if (dataExisting !== undefined) {
                            data = mergeDeep({}, {[key]: dataExisting}, data);
                        } else {
                            data = mergeDeep({}, data);
                        }
                    }
                    update(data);
                });

                // include current node's data into initial update data
                const field = modelNode.getAttribute('data-model');
                if (field) {
                    const isCheckbox = modelNode.tagName === 'INPUT' && modelNode.type === 'checkbox';
                    const valueRaw = isCheckbox ? modelNode.checked : modelNode.value;
                    const value = queryStringDecodedSetValue(field, valueRaw);
                    data = mergeDeep(data, value);
                }
            });

            // run the initial data update with data gathered from all model nodes
            update(data);
        }
    }

    // normally, ref will return a HTMLElement, however if ref attribute is found on a component tag
    // this will upgrade it to ClientComponent
    private promoteRefs() {
        this.children.forEach((child) => {
            const ref = child.domNode.getAttribute('ref');
            if (ref) {
                this.refs[ref] = child;
            }
        });
    }

    // returns a single HTMLElement or ClientComponent that has ref="refName" attribute
    // if ref attribute is on a component tag, the ref will be promoted to ClientComponent
    // in other cases it returns the HTMLElement
    // this does not check if the ref exists
    // you should make sure it does, otherwise you will get undefined at runtime
    public ref<T>(refName: string): T {
        return this.refs[refName] as T;
    }

    // returns an array of HTMLElement (type of the elements can be specified) that have array:ref="refName"
    public refArray<T>(refName: string): Array<T> {
        return (this.refsArray[refName] || []) as Array<T>;
    }

    // condition can be one of:
    // 1) access to a boolean property in component store: [key]
    // 2) comparison of a store property [key] ==|===|!=|<|>|<=|>= [comparison value or key]
    // 3) method methodName() or methodName(arg)
    private execCondition(conditionRaw: string): boolean {
        const condition = conditionRaw.trim();
        const isMethod = condition.endsWith(')');

        if (isMethod) {
            // method (case 3)
            // method has to be in format !?[a-zA-Z]+[a-zA-Z0-9_]+\([^)]+\)
            // extract expression parts
            const parts = /^(!?)\s*([a-zA-Z]+[a-zA-Z0-9_]*)\(([^)]*)\)$/.exec(condition);
            if (parts === null) {
                console.error(`Could not parse condition ${condition}`);
                return false;
            }
            const negated = parts[1] === '!';
            const functionName = parts[2];
            const args = parts[3].trim();

            // make sure there is a registered callback with this name
            if (typeof this.conditionalCallbacks[functionName] !== 'function') {
                console.warn(`No registered conditional callback '${functionName}'`);
                return false;
            }

            // run registered callback
            const isTrue = this.conditionalCallbacks[functionName](args === '' ? undefined : eval(`(${args})`));
            if (negated) {
                return ! isTrue;
            }
            return isTrue;
        } else {
            // expression not a method
            const parts = /^(!)?\s*([a-zA-Z]+[a-zA-Z0-9_]*)\s*((?:==)|(?:===)|(?:!=)|<|>|(?:<=)|(?:>=))?\s*([^=].+)?$/.exec(condition);
            if (parts === null) {
                console.error(`Could not parse condition ${condition}`);
                return false;
            }
            
            const property = parts[2];
            const value = this.store.get(property);
            const isComparison = parts[3] !== undefined;
            if (isComparison) {
                // comparison (case 2)
                // left hand side is the property name, right hand side is an expression
                const rightHandSide = eval(`${parts[4]}`);

                const comparisonSymbol = parts[3];

                if (comparisonSymbol === '==') {
                    return value == rightHandSide;
                } else if (comparisonSymbol === '===') {
                    return value === rightHandSide;
                } else {
                    // number comparison
                    if (typeof value !== 'number') {
                        // if value is not a number, these comparisons makes no sense, return false
                        return false;
                    }
                    if (comparisonSymbol === '>') {
                        return value > rightHandSide;
                    } else if (comparisonSymbol === '>=') {
                        return value >= rightHandSide;
                    } else if (comparisonSymbol === '<') {
                        return value < rightHandSide;
                    } else if (comparisonSymbol === '<=') {
                        return value <= rightHandSide;
                    } else if (comparisonSymbol === '!=') {
                        return value != rightHandSide;
                    }
                }

                return false;

            } else {
                // not a comparison (case 1)
                const negated = parts[1] === '!';
                const isTrue = this.store.get<boolean>(property);
                if (negated) {
                    return !isTrue;
                }
                // value may not be a boolean, coerce to boolean without changing value
                return !!isTrue;
            }
        }
    }

    // conditionals (data-if and data-classname-[className]) both support methods in condition
    // eg. data-if="someMethod()"
    // this allows users to define callbacks used in conditionals' conditions
    // by default, this also runs updateConditionals
    // as there might be conditionals that are using this callback
    public conditionalCallback(name: string, callback: (args?: any) => boolean, updateConditionals: boolean = true): void {
        this.conditionalCallbacks[name] = callback;
        if (updateConditionals) {
            this.updateConditionals(false);
        }
    }

    // updates conditionals (data-if and data-classname-[className])
    // data-if (conditionally show/hide DOM node)
    // data-classname-[className] (conditionally add className to classList of the DOM node)
    private updateConditionals(enableTransition: boolean) {
        if (this.destroyed) {return;}

        // data-if conditions
        this.conditionals.forEach((node) => {
            const condition = node.getAttribute('data-if');
        
            if (typeof condition === 'string') {
                const show = this.execCondition(condition);

                if (show === true) {
                    // node.style.display = '';
                    this.show(node, enableTransition);
                } else {
                    // node.style.display = 'none';
                    this.hide(node, enableTransition);
                }
            }
        });

        // data-classname conditions
        this.conditionalClassNames.forEach((conditional) => {
            const condition = conditional.element.getAttribute(`data-classname-${conditional.className}`);
        
            if (typeof condition === 'string') {
                const enableClassName = this.execCondition(condition);

                if (enableClassName === true) {
                    conditional.element.classList.add(conditional.className);
                } else {
                    conditional.element.classList.remove(conditional.className);
                }
            }
        });
    }

    // remove the DOM node and delete from parent.children effectively removing self from the tree
    // the method could be sync, but since we want to allow for potentially async user destructors
    // it is async
    public async remove() {
        if (!this.isRoot) {
            // remove children recursively
            const children = Array.from(this.children);
            for (let i = 0; i < children.length; i++) {
                await children[i].remove();
            }

            // remove from parent's children array
            if (this.parent) {
                this.parent.children.splice(this.parent.children.indexOf(this), 1);
            }

            // remove DOM node
            this.domNode.parentElement?.removeChild(this.domNode);
            await this.destroy();

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

    // find a component with given name within this component
    // if recursive = true, it searches recursively
    // returns the first found component or null if no components were found
    public find(componentName: string, recursive: boolean = true): null | ClientComponent {
        for (let i = 0; i < this.children.length; i++) {
            const child = this.children[i];
            if (child.name == componentName) {
                // found it
                return child;
            } else {
                if (recursive) {
                    // search recursively, if found return
                    const inChild = child.find(componentName, recursive);
                    if (inChild) {
                        return inChild;
                    }
                }
            }
        }
        return null;
    }

    // find all components with given name within this component
    // if recursive = true, it searches recursively
    // returns an array of found components
    public query(componentName: string, results: Array<ClientComponent> = [], recursive: boolean = true): Array<ClientComponent> {
        for (let i = 0; i < this.children.length; i++) {
            const child = this.children[i];
            if (child.name == componentName) {
                // found a component with name = componentName, add to results
                results.push(child);
            } else {
                if (recursive) {
                    // search recursively, if found return
                    child.query(componentName, results, recursive);
                }
            }
        }
        return results;
    }

    // adds a new component to DOM/component tree
    // appendTo is a selector within this component's DOM or a HTMLElement (which can be outside this component)
    // data can be an object which is passed to added component
    // regardless whether appendTo is within this component or not,
    // added component will always be a child of this component
    // returns a promise that resolves with the added component
    public async add(appendTo: string | HTMLElement, componentName: string, data?: LooseObject): Promise<ClientComponent | null> {
        const container = typeof appendTo === 'string' ? this.domNode.querySelector(appendTo) : appendTo;

        if (! (container instanceof HTMLElement)) {
            throw new Error(`${this.name}.add() - appendTo selector not found within this component`);
        }

        // request rendered component from the server
        // expected result is JSON, containing { html, initializers, data }
        // unwrap set to false as we want the component container to be returned (unlike redraw)
        const req = new NetRequest('POST', '/componentRender', {
            'content-type': 'application/json'
        });
        const componentDataJSON = await req.send(JSON.stringify({
            component: componentName,
            attributes: data,
            unwrap: false
        }));

        const res: {
            html: string;
            initializers: Record<string, string>;
            data: LooseObject;
        } = JSON.parse(componentDataJSON);

        // if the current document did not include the added component (or components loaded within it)
        // it's initializer will not be present in window.initializers
        // add any missing initializers to global initializers list
        for (let key in res.initializers) {
            if (!window.initializers[key]) {
                window.initializers[key] = res.initializers[key];
            }
        }

        // create a temporary container to load the returned HTML into
        const tmpContainer = document.createElement('div');
        tmpContainer.innerHTML = res.html;

        // get the first child, which is always the component wrapper <div data-component="..."></div>
        const componentNode = tmpContainer.firstChild as HTMLElement;

        // create an instance of ClientComponent for the added component and add it to this.children
        const component = new ClientComponent(this, componentName, componentNode, this.storeGlobal);
        this.children.push(component);

        // add the component's DOM node to container
        container.appendChild(componentNode);

        return component;
    }

    public getData<T>(key?: string): T {
        if (!key) {
            return this.data as T;
        }
        return this.data[key] as T;
    }

    // shows a previously hidden DOM node (domNode.style.display = '')
    // if the DOM node has data-transition attributes, it will run the transition while showing the node
    public show(domNode: HTMLElement, enableTransition: boolean = true) {
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

    // hides the given DOM node (domNode.style.display = 'none')
    // if the DOM node has data-transition attributes, it will run the transition before hiding the node
    public hide(domNode: HTMLElement, enableTransition: boolean = true) {
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

    // reads attribute values of
    // data-transition-show-slide, data-transition-show-fade,
    // data-transition-hide-slide, data-transition-hide-fade
    // and parses them into ClientComponentTransitions object
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

        objectEach(transitions, (transitionEvent, transition) => {
            objectEach(transition, (transitionType) => {
                const attributeName = `data-transition-${transitionEvent}-${transitionType}`;
                if (domNode.hasAttribute(attributeName)) {
                    const valueRaw = domNode.getAttribute(attributeName);
                    let value: number | false = false;
                    if (typeof valueRaw === 'string' && /^\d+$/.test(valueRaw)) {
                        value = parseInt(valueRaw);
                    }
                    transition[transitionType] = value;
                }
            });
        });

        return transitions;
    }

    // reads data-transition-axis-[show|hide] of given domNode
    // returns "" if attribute is missing or has an unrecognized value
    // return "X" or "Y" if a proper value is found
    private transitionAxis(domNode: HTMLElement, showHide: 'show' | 'hide'): 'X' | 'Y' | '' {
        const attributeName = `data-transition-axis-${showHide}`;
        if (! domNode.hasAttribute(attributeName)) {return '';}
        let val = domNode.getAttribute(attributeName);
        if (typeof val === 'string') {
            val = val.trim().toUpperCase();
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

    private async destroy(): Promise<void> {

        // if being redrawn, abort redraw request
        if (this.redrawRequest) {
            this.redrawRequest.abort();
            this.redrawRequest = null;
        }

        // if the user has defined a destroy callback, run it
        if (typeof this.onDestroy === 'function') {
            await this.onDestroy.apply(this);
        }

        this.store.destroy();

        // remove all event listeners attached to DOM elements
        this.unbindAll();

        // clean up and free memory
        this.conditionals = [];
        this.conditionalClassNames = [];
        this.conditionalCallbacks = {};
        this.refs = {};
        this.refsArray = {};
        this.initializer = null;
        this.data = {};

        // mark destroyed
        this.destroyed = true;
    }

    // add an event listener to given DOM node
    // stores it to ClientComponent.bound so it can be unbound when needed using unbindAll
    public bind(element: HTMLElement, event: string, callback: (e: Event) => void) {
        if (element instanceof HTMLElement) {
            this.bound.push({
                element,
                event,
                callback
            });
            element.addEventListener(event, callback);
        }
    }

    // remove all bound event listeners using ClientComponent.bind
    private unbindAll() {
        this.bound.forEach((bound) => {
            bound.element.removeEventListener(bound.event, bound.callback);
        });
        this.bound = [];
    }
}