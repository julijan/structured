import { StoreChangeCallback } from '../types/store.types.js';
import { LooseObject } from '../types/general.types.js';
import {
    ClientComponentEventCallback,
    ClientComponentBoundEvent,
    ClientComponentTransition,
    ClientComponentTransitions
} from '../types/component.types.js';
import {
    attributeValueFromString,
    attributeValueToString,
    mergeDeep,
    objectEach,
    queryStringDecodedSetValue,
    toCamelCase
} from '../Util.js';
import { DataStoreView } from './DataStoreView.js';
import { Net } from './Net.js';
import { NetRequest } from './NetRequest.js';
import { EventEmitter } from '../EventEmitter.js';
import { ClientApplication } from './ClientApplication.js';

export class ClientComponent extends EventEmitter {
    readonly name: string;
    children: Array<ClientComponent> = [];
    readonly parent: ClientComponent;
    readonly domNode: HTMLElement;
    readonly isRoot: boolean;
    readonly root: ClientComponent;
    store: DataStoreView;
    private app: ClientApplication;
    readonly net: Net = new Net();
    private initializerExecuted: boolean = false;

    // user defined component functions
    // these are stored in components DataStoreView and survive redraw
    // should be used when adding EventEmitter callbacks to self or components not nested within current component
    // in order to prevent same callback to be bound when the component is redrawn
    // not necessary for components nested within this component as those will get destroyed in the process
    // example bad:
    // this.on('beforeRedraw', () => {...}) // this will get bound on every redraw and will fire multiple times
    // example good
    // this.fn.beforeRedraw = () => {...}
    // this.on('beforeRedraw', this.fn.beforeRedraw)
    public readonly fn: Record<string, (...args: Array<any>) => any | undefined>;

    destroyed: boolean = false;

    private redrawRequest: XMLHttpRequest | null = null;

    // callbacks bound using bind method
    private bound: Array<ClientComponentBoundEvent<LooseObject | undefined>> = [];

    // DOM elements within the component that have a data-if attribute
    private conditionals: Array<HTMLElement> = [];

    // available for use in data-if and data-classname-[className]
    private conditionalCallbacks: Record<string, (args?: any) => any> = {};

    private conditionalClassNames: Array<{
        element: HTMLElement,
        className: string
    }> = [];

    private refs: Record<string, HTMLElement | ClientComponent> = {};
    private refsArray: Record<string, Array<HTMLElement | ClientComponent>> = {};

    isReady: boolean = false;

    // data-attr are parsed into an object
    private data: LooseObject = {};

    constructor(parent: ClientComponent | null, name: string, domNode: HTMLElement, app: ClientApplication) {
        super();
        this.name = name;
        this.domNode = domNode;
        if (parent === null) {
            // only root has no parent
            // it becomes it's own parent
            this.isRoot = true;
            this.root = this;
            this.parent = this;
        } else {
            // not a root component
            this.isRoot = false;
            this.root = parent.root;
            this.parent = parent;
        }

        // create a DataStoreView for the current component
        // it uses component's id to create an isolated data context within global DataStore
        this.app = app;
        this.store = new DataStoreView(this.app.store, this);

        // initialize the proxy for fn (user defined component functions)
        // proxy is there to:
        // a) prvent assigning the same function multiple times (which would defeat the point on fn)
        // b) if the fuction is not defined, return a function that console.warn's about missing function
        const self = this;
        this.fn = new Proxy(this.store, {
            set(target, key: string, val: (args?: any) => any) {
                const fnKey = `fn_${key}`;
                if (target.has(fnKey)) {return true;}
                target.set(fnKey, val);
                return true;
            },

            get(target, key: string): (args?: any) => any {
                return target.get<(args?: any) => any>(`fn_${key}`) || (() => {
                    self.warn(`Function ${key} not defined`);
                });
            },
        }) as unknown as Record<string, (args?: any) => any>;

        if (this.isRoot) {
            // only root gets initialized by itself
            // rest of the component tree is initialized recursively starting from the bottom up
            this.init(false);
        }
    }

    // initialize component tree recursively
    private async init(isRedraw: boolean, data: LooseObject = {}) {
        const initializerExists = this.app.hasInitializer(this.name);

        // reset current node
        this.reset();

        // load data from attributes
        this.initData();

        // apply given data
        objectEach(data, (key, val) => {
            this.setData(key, val, false);
        });

        // create instances of ClientComponent for direct child components
        this.initChildren();

        // component is ready once all of it's children get initialized
        // this means that components with no children will get initialized first
        // bubbling all the way up to root
        // root is the last to be initialized/ready
        await Promise.all(this.children.map(async (child) => {
            await child.init(isRedraw);
        }));


        if (!initializerExists && this.conditionals.length > 0) {
            // component has no initializer, import all exported fields
            // while they won't be accessed from the store directly, as there is no initializer
            // they might still be used as conditionals eg. in data-if
            this.store.import(undefined, false, false);
        }
        
        // initialize refs, data, models and conditionals
        // promote refs to ClientComponent where ref is on a component tag
        this.initRefs();
        this.initModels();
        this.initConditionals();

        // run initializer for current component
        await this.runInitializer(isRedraw);

        // run initial updateConditionals
        // initial updateConditionals always runs with transitions disabled
        this.updateConditionals(false);

        // update conditionals whenever any data in component's store has changed
        this.store.onChange('*', () => {
            this.updateConditionals(true);
        });

        // deferred component, redraw it immediately
        if (this.data.deferred === true) {
            this.setData('deferred', false, false);
            this.redraw();
        }

        // all the child components ready and the component is ready
        this.isReady = true;
        this.emit('ready');
        
    }

    private reset() {
        this.data = {}
        this.isReady = false;
        this.refs = {};
        this.refsArray = {};
        this.conditionalClassNames = [];
        this.conditionalCallbacks = {};
        this.conditionals = [];
        this.redrawRequest = null;
        this.initializerExecuted = false;
        this.bound = [];
        this.children = [];
    }

    // set initializer callback and execute it
    private async runInitializer(isRedraw: boolean = false) {
        if (!this.initializerExecuted && !this.destroyed) {
            const initializer = this.app.getInitializer(this.name);
            if (initializer === null) {return;}
            await initializer.apply(this, [{
                net: this.net,
                isRedraw
            }]);
        }
        this.initializerExecuted = true;
    }

    // populates this.data with data found as data- prefixed attributes on this.domNode
    // this data can be accessed using this.getData
    private initData(): void {
        objectEach(this.attributeData(this.domNode), (key, val) => {
            this.setData(key, val, false);
        });
    }

    // parses all data-[key] attributes found on given HTMLElement into an object
    // keys are converted to camelCase
    // values are expected to be encoded using attributeValueToString
    // and will be decoded using attributeValueFromString
    private attributeData(node: HTMLElement): LooseObject {
        const data: LooseObject = {};

        for (let i = 0; i < node.attributes.length; i++) {
            if (/^((number|string|boolean|object|any):)?data-[^\s]+/.test(node.attributes[i].name)) {
                // data-attr, convert to dataAttr and store value
                const value = node.attributes[i].value;
                const attrData = attributeValueFromString(value);

                if (typeof attrData === 'object') {
                    data[attrData.key] = attrData.value;
                } else {
                    // not a valid attribute data string, assign as is (string)
                    const key = toCamelCase(node.attributes[i].name.substring(5));
                    data[key] = attrData;
                }
            }
        }

        return data;
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

    // find all DOM nodes with data-structured-component attribute within this component,
    // instantiate a ClientComponent with them and add them to this.children
    // if callback is a function, for each instantiated child
    // callback is executed with child as first argument
    private initChildren(scope?: HTMLElement, callback?: (component: ClientComponent) => void): void {
        scope = scope || this.domNode;

        for (let i = 0; i < scope.childNodes.length; i++) {
            const childNode = scope.childNodes[i];
            if (childNode.nodeType == 1) {
                if ((childNode as HTMLElement).hasAttribute(`data-${window.structuredClientConfig.componentNameAttribute}`)) {
                    // found a child component, add to children
                    const component = new ClientComponent(this, (childNode as HTMLElement).getAttribute(`data-${window.structuredClientConfig.componentNameAttribute}`) || '', childNode as HTMLElement, this.app);
                    this.children.push(component);
                    if (typeof callback === 'function') {
                        callback(component);
                    }
                } else {
                    // not a component, resume from here recursively
                    this.initChildren((childNode as HTMLElement), callback);
                }
            }
        }
    }

    // fetch from server and replace with new HTML
    // if data is provided, each key will be set on component using this.setData
    // and as such, component will receive it when rendering
    public async redraw(data?: LooseObject): Promise<void> {

        if (window.structuredClientConfig.componentRender === false) {
            this.error(`Can't redraw component, component rendering URL disabled`);
            return;
        }

        if (this.destroyed) {return;}

        this.emit('beforeRedraw');

        // abort existing redraw call, if in progress
        if (this.redrawRequest !== null) {
            this.redrawRequest.abort();
            this.redrawRequest = null;
        }

        // request a component to be re-rendered on the server
        // unwrap = true so that component container is excluded
        // this component already has it's own container and we only care about what changed within it
        const redrawRequest = new NetRequest('POST', window.structuredClientConfig.componentRender, {
            'content-type': 'application/json'
        });
        this.redrawRequest = redrawRequest.xhr;
        const componentDataJSON = await redrawRequest.send(JSON.stringify({
            component: this.name,
            attributes: Object.assign(this.data, data || {}),
            unwrap: true
        }));
        // clear redraw request as the request is executed and does not need to be cancelled
        // in case component gets redrawn again
        this.redrawRequest = null;

        // should only happen if a previous redraw attempt was aborted
        if (componentDataJSON.length === 0) { return; }

        // mark component as not loaded
        this.isReady = false;

        // remove all bound event listeners as DOM will get replaced in the process
        this.unbindAll();

        // destroy existing children as their associated domNode is no longer part of the DOM
        // new children will be initialized based on the new DOM
        // new DOM may contain same children (same componentId) however by destroying the children
        // any store change listeners will be lost, before destroying each child
        // keep a copy of the store change listeners, which we'll use later to restore those listeners
        const childStoreChangeCallbacks: Record<string, Record<string, Array<StoreChangeCallback>>> = {}
        const childrenOld = Array.from(this.children);
        for (let i = 0; i < childrenOld.length; i++) {
            const child = childrenOld[i];
            childStoreChangeCallbacks[child.getData<string>('componentId')] = child.store.onChangeCallbacks();
            await child.remove();
        }

        const componentData: {
            html: string;
            initializers: Record<string, string>;
            data: LooseObject;
        } = JSON.parse(componentDataJSON);

        // populate this.domNode with new HTML
        this.domNode.innerHTML = componentData.html;

        // register any new initializers returned
        for (const componentName in componentData.initializers) {
            this.app.registerInitializer(componentName, componentData.initializers[componentName]);
        }

        await this.init(true, componentData.data);

        for (let i = 0; i < this.children.length; i++) {
            const childNew = this.children[i];
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
        }

        this.emit('afterRedraw');
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
            if (child.nodeType === 1 && (isSelf || !node?.hasAttribute(`data-${window.structuredClientConfig.componentNameAttribute}`))) {
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
            if (child.nodeType === 1 && (isSelf || !node?.hasAttribute(`data-${window.structuredClientConfig.componentNameAttribute}`))) {
                this.initRefs(child as HTMLElement);
            }
        });

        this.promoteRefs();
    }

    // make inputs with data-model="field" work
    // nested data works too, data-model="obj[nested][key]" or data-model="obj[nested][key][]"
    private initModels(node?: HTMLElement, modelNodes: Array<HTMLInputElement> = []) {
        const isSelf = node === undefined;
        if (node === undefined) {
            node = this.domNode;
        }

        if (node.hasAttribute('data-model') && (node.tagName === 'INPUT' || node.tagName === 'SELECT' || node.tagName === 'TEXTAREA')) {
            // found a model node, store to array modelNodes
            modelNodes.push(node as HTMLInputElement);
        } else {
            // not a model, but may contain models
            // init model nodes recursively from here
            node.childNodes.forEach((child) => {
                if (child.nodeType === 1 && (isSelf || !node?.hasAttribute(`data-${window.structuredClientConfig.componentNameAttribute}`))) {
                    this.initModels(child as HTMLElement, modelNodes);
                }
            });
        }

        if (isSelf) {
            // all model nodes are now contained in modelNodes array

            // given a HTMLInput element that has data-model attribute, returns an object with the data
            // for example:
            // data-model="name" may result with { name: "John" }
            // data-model="user[name]" may result with { user: { name: "John" } }
            const modelData = (node: HTMLInputElement): LooseObject => {
                const field = node.getAttribute('data-model');
                if (field) {
                    const isCheckbox = node.tagName === 'INPUT' && node.type === 'checkbox';
                    const valueRaw = isCheckbox ? node.checked : node.value;
                    let valueCasted: string | number | boolean | null = valueRaw;

                    if (!isCheckbox && typeof valueRaw === 'string') {
                        // if data-type is found on node try casting data to desired type
                        // recognized values are string (no type casting), number and boolean
                        // data casting not done for checkboxes, they always yield a boolean
                        const dataType = isCheckbox ? 'boolean' : node.getAttribute('data-type') || 'string';

                        // if data-nullable is found on node, empty string is considered null
                        const nullable = node.hasAttribute('data-nullable');

                        if (nullable && valueRaw.trim().length === 0) {
                            // value is an empty string, if nullable, set value to null
                            valueCasted = null;
                        } else {
                            if (dataType === 'number') {
                                // cast to number

                                if (valueRaw.trim().length === 0) {
                                    // empty string, assume 0
                                    valueCasted = 0;
                                } else {
                                    // value not empty
                                    const num = parseFloat(valueRaw);
        
                                    if (isNaN(num)) {
                                        // invalid number entered, null if nullable, otherwise 0
                                        valueCasted = nullable ? null : 0;
                                    } else {
                                        valueCasted = num;
                                    }
                                }

                            } else if (dataType === 'boolean') {

                                // "1" and "true" casted to true, otherwise false
                                if (valueRaw === '1' || valueRaw === 'true') {
                                    valueCasted = true;
                                } else {
                                    valueCasted = false;
                                }
                            }
                        }

                    }

                    const value = queryStringDecodedSetValue(field, valueCasted);
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

            // data for the initial update, we want to gather all data up in one object
            // so that nested keys don't trigger more updates than necessary
            let data: LooseObject = {}
            modelNodes.forEach((modelNode) => {
                // on change, update component data
                this.bind(modelNode, 'input', () => {
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
                    // don't update radio inputs, unless checked
                    const updateModel = modelNode.type !== 'radio' || modelNode.checked;
                    if (updateModel) {
                        const valueObject = modelData(modelNode);
                        data = mergeDeep(data, valueObject);
                    }
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
            // promote regular refs
            const ref = child.domNode.getAttribute('ref');
            if (ref) {
                this.refs[ref] = child;
            }

            // promote array refs
            const refArray = child.domNode.getAttribute('array:ref');
            if (refArray !== null && refArray in this.refsArray) {
                const nodeIndex = this.refsArray[refArray].indexOf(child.domNode);
                if (nodeIndex > -1) {
                    this.refsArray[refArray].splice(nodeIndex, 1, child);
                }
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
                this.error(`Could not parse condition ${condition}`);
                return false;
            }
            const negated = parts[1] === '!';
            const functionName = parts[2];
            const args = parts[3].trim();

            // make sure there is a registered callback with this name
            if (typeof this.conditionalCallbacks[functionName] !== 'function') {
                this.warn(`No registered conditional callback '${functionName}'`);
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
            const parts = /^(!)?\s*([a-zA-Z0-9_]+)\s*((?:==)|(?:===)|(?:!=)|(?:!==)|<|>|(?:<=)|(?:>=))?\s?([^=]+)?$/.exec(condition);
            if (parts === null) {
                this.error(`Could not parse condition ${condition}`);
                return false;
            }
            
            const property = parts[2];
            const value = this.store.get(property);
            const isComparison = parts[3] !== undefined;
            if (isComparison) {
                // comparison (case 2)
                // left hand side is the property name, right hand side is an expression
                let rightHandSide = null;
                try {
                    // this won't fail as long as parts[4] is a recognized primitive (number, boolean, string...)
                    rightHandSide = eval(`${parts[4]}`);
                } catch(e) {
                    // parts[4] failed to be parsed as a primitive
                    // assume it's a store value to allow comparing one store value to another
                    rightHandSide = this.store.get(parts[4]);
                }

                const comparisonSymbol = parts[3];

                if (comparisonSymbol === '==') {
                    return value == rightHandSide;
                } else if (comparisonSymbol === '===') {
                    return value === rightHandSide;
                } else if (comparisonSymbol === '!=') {
                    return value != rightHandSide;
                } else if (comparisonSymbol === '!==') {
                    return value !== rightHandSide;
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
    public async remove(): Promise<void> {
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
    public query(componentName: string, recursive: boolean = true, results: Array<ClientComponent> = []): Array<ClientComponent> {
        for (let i = 0; i < this.children.length; i++) {
            const child = this.children[i];
            if (child.name == componentName) {
                // found a component with name = componentName, add to results
                results.push(child);
            } else {
                if (recursive) {
                    // search recursively, if found return
                    child.query(componentName, recursive, results);
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
        if (window.structuredClientConfig.componentRender === false) {
            this.error(`Can't add component, component rendering URL disabled`);
            return null;
        }

        const container = typeof appendTo === 'string' ? this.domNode.querySelector(appendTo) : appendTo;

        if (! (container instanceof HTMLElement)) {
            throw new Error(`${this.name}.add() - appendTo selector not found within this component`);
        }

        // request rendered component from the server
        // expected result is JSON, containing { html, initializers, data }
        // unwrap set to false as we want the component container to be returned (unlike redraw)
        const req = new NetRequest('POST', window.structuredClientConfig.componentRender, {
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
        for (let componentName in res.initializers) {
            this.app.registerInitializer(componentName, res.initializers[componentName]);
        }

        // create a temporary container to load the returned HTML into
        const tmpContainer = document.createElement('div');
        tmpContainer.innerHTML = res.html;

        // get the first child, which is always the component wrapper <div data-structured-component="..."></div>
        const componentNode = tmpContainer.firstChild as HTMLElement;

        // create an instance of ClientComponent for the added component and add it to this.children
        const component = new ClientComponent(this, componentName, componentNode, this.app);
        this.children.push(component);
        await component.init(false, res.data);

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
    public show(domNode: HTMLElement, enableTransition: boolean = true): void {
        if (!enableTransition) {
            domNode.style.display = '';
            return;
        }

        if (domNode.style.display !== 'none') { return; }

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
            domNode.style.transformOrigin = '';
            domNode.style.transform = '';
            domNode.removeEventListener('transitionend', onTransitionEnd);
            domNode.removeEventListener('transitioncancel', onTransitionEnd);
        };

        domNode.addEventListener('transitionend', onTransitionEnd);
        domNode.addEventListener('transitioncancel', onTransitionEnd);

        if (transitionsActive.slide) {
            // if specified use given transformOrigin
            
            const axis = this.transitionAxis(domNode, 'show');
            let slideDirection = axis === 'X' ? 'left' : 'up';
            const invert = domNode.hasAttribute('data-transition-slide-invert');
            if (invert) {
                slideDirection = slideDirection === 'left' ? 'right' : (slideDirection === 'up' ? 'down' : 'up');
            }
            const slideLengthMultiplier = slideDirection === 'down' || slideDirection === 'right' ? -1 : 1;
            const slideLength = (axis === 'X' ? domNode.clientWidth : domNode.clientHeight) * 0.5 * slideLengthMultiplier * -1;
            domNode.style.transform = `translate${axis === 'X' ? 'X' : 'Y'}(${slideLength}px)`;
            setTimeout(() => {
                domNode.style.transition = `transform ${transitionsActive.slide}ms linear`;
                domNode.style.transform = `translate${axis === 'X' ? 'X' : 'Y'}(0)`;
            }, 50);
        }

        if (transitionsActive.grow) {

            // if specified use given transformOrigin
            const transformOrigin = domNode.getAttribute('data-transform-origin-show') || '50% 0';

            domNode.style.transformOrigin = transformOrigin;
            const axis = this.transitionAxis(domNode, 'show');
            domNode.style.transform = `scale${axis}(0.01)`;
            domNode.style.transition = `transform ${transitionsActive.grow}ms`;
            setTimeout(() => {
                // domNode.style.height = height + 'px';
                domNode.style.transform = `scale${axis}(1)`;
            }, 100);
        }

        if (transitionsActive.fade) {
            domNode.style.opacity = '0';
            domNode.style.transition = `opacity ${transitionsActive.fade}ms`;
            setTimeout(() => {
                domNode.style.opacity = '1';
            }, 100);
        }

    }

    // hides the given DOM node (domNode.style.display = 'none')
    // if the DOM node has data-transition attributes, it will run the transition before hiding the node
    public hide(domNode: HTMLElement, enableTransition: boolean = true): void {
        if (!enableTransition) {
            domNode.style.display = 'none';
            return;
        }

        if (domNode.style.display === 'none') { return; }

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
                // if specified use given transformOrigin
                domNode.style.transition = `transform ${transitionsActive.slide}ms linear`;
                const axis = this.transitionAxis(domNode, 'hide');
                let slideDirection = axis === 'X' ? 'left' : 'up';
                const invert = domNode.hasAttribute('data-transition-slide-invert');
                if (invert) {
                    slideDirection = slideDirection === 'left' ? 'right' : (slideDirection === 'up' ? 'down' : 'up');
                }
                setTimeout(() => {
                    const slideLengthMultiplier = slideDirection === 'down' || slideDirection === 'right' ? -1 : 1;
                    const slideLength = (axis === 'X' ? domNode.clientWidth : domNode.clientHeight) * 0.5 * slideLengthMultiplier * -1;
                    domNode.style.transform = `translate${axis === 'X' ? 'X' : 'Y'}(${slideLength}px)`;
                }, 50);
            }

            if (transitionsActive.grow) {
                // if specified use given transformOrigin
                const transformOrigin = domNode.getAttribute('data-transform-origin-hide') || '50% 100%';

                domNode.style.transformOrigin = transformOrigin;
                domNode.style.transition = `transform ${transitionsActive.grow}ms ease`;
                setTimeout(() => {
                    const axis = this.transitionAxis(domNode, 'hide');
                    domNode.style.transform = `scale${axis}(0.01)`;
                }, 50);
            }

            if (transitionsActive.fade) {
                domNode.style.opacity = '1';
                domNode.style.transition = `opacity ${transitionsActive.fade}ms`;
                setTimeout(() => {
                    domNode.style.opacity = '0';
                }, 50);
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
                fade: false,
                grow: false,
            },
            hide: {
                slide: false,
                fade: false,
                grow: false,
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

        this.emit('beforeDestroy');

        this.store.destroy();

        // remove all event listeners attached to DOM elements
        this.unbindAll();

        // clean up and free memory
        this.reset();

        // mark destroyed
        this.destroyed = true;

        this.emit('afterDestroy');

        // destroy EventEmitter (unbinding all event listeners)
        this.emitterDestroy();
    }

    // add an event listener to given DOM node
    // stores it to ClientComponent.bound so it can be unbound when needed using unbind/unbindAll
    // callback receives event as the first argument, attributeData as the second argument
    // type of expected attribute data can be specified as generic
    public bind<T extends LooseObject | undefined = undefined>(
        element: HTMLElement | Window | Array<HTMLElement | Window>,
        event: keyof HTMLElementEventMap | Array<keyof HTMLElementEventMap>,
        callback: ClientComponentEventCallback<T>
    ): void {
        if (Array.isArray(element)) {
            // multiple elements given
            // bind for each individually
            element.forEach((el) => {
                this.bind(el, event, callback);
            });
            return;
        }

        if (Array.isArray(event)) {
            event.forEach((eventName) => {
                this.bind(element, eventName, callback);
            });
            return;
        }
        const isWindow = element instanceof Window;
        if (element instanceof HTMLElement || isWindow) {
            // wrap provided callback
            // wrapper will make sure provided callback receives data (attributeData) as the second argument
            const callbackWrapper = (e: Event) => {
                callback.apply(this, [e, isWindow ? undefined : this.attributeData(element), element]);
            }
            this.bound.push({
                element,
                event,
                callback: callbackWrapper,
                callbackOriginal: callback
            });
            element.addEventListener(event, callbackWrapper);
        }
    }

    // remove event listener added using bind method
    public unbind<T extends LooseObject | undefined = undefined>(
        element: HTMLElement,
        event: keyof HTMLElementEventMap | Array<keyof HTMLElementEventMap>,
        callback: ClientComponentEventCallback<T>
    ): void {

        if (Array.isArray(event)) {
            event.forEach((eventName) => {
                this.unbind(element, eventName, callback);
            });
            return;
        }
        const boundIndex = this.bound.findIndex((bound) => {
            return bound.event === event && bound.element === element && bound.callbackOriginal === callback;
        });
        if (boundIndex > -1) {
            const bound = this.bound[boundIndex];
            bound.element.removeEventListener(bound.event, bound.callback);
            this.bound.splice(boundIndex, 1);
        }
    }

    // remove all bound event listeners using ClientComponent.bind
    private unbindAll() {
        this.bound.forEach((bound) => {
            bound.element.removeEventListener(bound.event, bound.callback);
        });
        this.bound = [];
    }

    public log(msg: any): void {
        console.log(this.name, msg);
    }

    public warn(msg: any): void {
        console.warn(this.name, msg);
    }

    public error(err: any): void {
        console.error(this.name, err);
    }
}