
import { IncomingHttpHeaders } from 'http';
import { AsteriskAny, InitializerFunction, InitializerFunctionContext, LooseObject, RequestMethod, StoreChangeCallback } from '../Types.js';
import { toCamelCase } from '../Util.js';

export class App {

    // TODO: use config value - currently cant import Conf.ts as it would have to be exposed to client
    // which is a bad idea as it may contain sensitive data
    componentRenderURI: string = '/component';
    root: Component;
    initializerContext: InitializerFunctionContext;
    store: DataStore = new DataStore();

    constructor() {
        this.root = new Component(null, 'root', document.body, this.store);

        // this is provided as an argument to each component's initializer function
        this.initializerContext = {
            net: new Net()
        }
    }

    // // fetch a component from the server as HTML string
    // public async fetch(componentName: string, primaryKey?: string|number): Promise<string> {
    //     return this.net.get(`${this.componentRenderURI}/${componentName}/${primaryKey || ''}`);
    // }

}

export class Component {

    name: string;
    children: Array<Component> = [];
    parent: Component;
    domNode: HTMLElement;
    isRoot: boolean;
    root: Component;
    store: DataStoreView;
    storeGlobal: DataStore;

    conditionals: Array<HTMLElement> = [];

    loaded: boolean;

    // callback executed each time the component is redrawn
    // this is the ideal place for binding any event listeners within component
    initializer : InitializerFunction|null = null;

    // data-attr are parsed into an object
    data: {
        [key: string] : string
    } = {};

    dataAttributes: {
        [key: string] : string
    } = {};

    constructor(parent: Component|null, name: string, domNode: HTMLElement, store: DataStore) {
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

        this.initData();

        this.storeGlobal = store;
        this.store = new DataStoreView(store, this.data.componentId);

        this.initChildren(this.domNode, this);
        this.initConditionals();

        this.loaded = ! this.data.if;

        // @ts-ignore
        if (initializers && initializers[this.name]) {
            // @ts-ignore
            this.init(new Function('const init = ' + initializers[this.name] + '; init.apply(this, [...arguments]);'));
        }

        // update conditionals whenever any data in component's store has changed
        this.store.onChange('*', () => {
            this.updateConditionals();
        });

        // update conditionals as soon as component is initialized
        this.updateConditionals();
    }

    // set initializer callback and execute it
    init(initializer: InitializerFunction) {
        this.initializer = initializer;
        this.initializer.apply(this, [{
            net: new Net()
        }]);
    }

    // parse all data-attr attributes into this.data object converting the data-attr to camelCase
    private initData(): void {
        for (let i = 0; i < this.domNode.attributes.length; i++) {

            // store original attributes
            this.dataAttributes[this.domNode.attributes[i].name] = this.domNode.attributes[i].value;

            // data-attr, convert to dataAttr and store value
            if (this.domNode.attributes[i].name.indexOf('data-') === 0) {
                const key = toCamelCase(this.domNode.attributes[i].name.substring(5));
                let value = this.domNode.attributes[i].value;
                if (key === 'componentData') {
                    value = JSON.parse(value);
                }
                this.data[key] = value;
            }
        }
    }

    // array of attribute data all the way up to root, or the first component with no dependencies (no data-use attribute)
    // used for redraw
    public pathData(): Array<{
        [key: string] : string
    }> {
        let current: Component = this;
        const data = [];
        do {
            data.push(current.data);
            if (current.isRoot || ! current.data.use) {
                break;
            }
            current = current.parent;
        } while(true);
        return data.reverse();
    }

    // first parent that can be redrawn (has no data-use)
    private redrawableParent(): Component {
        let current: Component = this;
        do {
            if (current.isRoot || ! current.data.use) {
                break;
            }
            current = current.parent;
        } while(true);
        return current;
    }

    private initChildren(scope?: HTMLElement, parent?: Component): void {

        if (scope === undefined) {
            scope = this.domNode;
        }

        for (let i = 0; i < scope.childNodes.length; i++) {
            let childNode = scope.childNodes[i];
            if (childNode.nodeType == 1) {
                // TODO: use config value - currently cant import Conf.ts as it would have to be exposed to client
                // which is a bad idea as it may contain sensitive data
                if ((childNode as HTMLElement).hasAttribute('data-component')) {
                    // found a child component, add to children
                    this.children.push(new Component(parent || null, (childNode as HTMLElement).getAttribute('data-component') || '', childNode as HTMLElement, this.storeGlobal));
                } else {
                    // not a component, resume from here recursively
                    this.initChildren((childNode as HTMLElement), this);
                }
            }
        }
    }

    // fetch from server and replace with new HTML
    public async redraw(): Promise<void> {
        // let net = new Net();
        // let html = await net.get('/component/' + this.name + (this.data.key ? '/' + this.data.key : ''));
        // this.domNode.innerHTML = html;

        // // re-init children because their associated domNode is no longer part of the DOM
        // // component initializers will get lost
        // this.children = [];
        // this.initChildren(this.domNode, this);

        // // run the initializer
        // if (this.initializer) {
        //     this.initializer.apply(this, [{
        //         net : new Net()
        //     }]);
        // }

        // component can't be redrawn if it uses data of it's parent component (data-use)
        // if the current node uses data, get the first parent that can be redrawn
        if (this.data.uses) {
            const redrawable = this.redrawableParent();
            redrawable.redraw();
            return;
        }

        console.log('redraw', this.name);
        let net = new Net();
        let html = await net.post('/componentRender', {
            component: this.name,
            attributes: this.dataAttributes
        });
        this.domNode.innerHTML = html;

        // re-init children because their associated domNode is no longer part of the DOM
        // component initializers will get lost
        this.children = [];
        this.initChildren(this.domNode, this);

        // run the initializer
        if (this.initializer) {
            this.initializer.apply(this, [{
                net : new Net()
            }]);
        }
    }

    private initConditionals(node?: HTMLElement): void {
        if (node === undefined) {
            node = this.domNode;
        }

        if (node.hasAttribute('data-if')) {
            this.conditionals.push(node);
        }

        node.childNodes.forEach((child) => {
            if (child.nodeType === 1) {
                this.initConditionals(child as HTMLElement);
            }
        });
    }

    private updateConditionals() {
        this.conditionals.forEach((node) => {
            const condition = node.getAttribute('data-if');
            let show: any = false;
            if (condition) {
                if (condition.endsWith('()')) {
                    // method
                    // try calling this.[condition]()
                    // it should return a boolean
                    const prop = this[condition as keyof Component];
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

                if (show == true) {
                    if (node.getAttribute('data-component')) {
                        const conditionalChild = this.children.find((child) => {
                            return child.domNode === node;
                        });
                        if (conditionalChild) {
                            if (! conditionalChild.loaded) {
                                // conditional child not yet loaded
                                conditionalChild.redraw();
                                conditionalChild.domNode.style.display = '';
                            }
                        }
                    }
                    node.style.display = '';
                } else {
                    node.style.display = 'none';
                }
            }
        });
    }

    // remove the DOM node and delete from parent.children effectively removing self from the tree
    public remove() {
        if (! this.isRoot) {
            this.domNode.parentElement?.removeChild(this.domNode);
            if (this.parent) {
                this.parent.children.splice(this.parent.children.indexOf(this), 1);
            }
        }
    }

    // travel up the tree until a parent with given parentName is found
    // if no such parent is found returns null
    public parentFind(parentName: string): Component|null {
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
    public find(componentName: string): null|Component {
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
    public query(componentName: string, results: Array<Component> = []): Array<Component> {
        for (let i = 0; i < this.children.length; i++) {
            let child = this.children[i];
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
    public async add(appendTo: string, componentName: string, data?: LooseObject, attributes?: {[key: string] : string}) {

        console.log('create', componentName);

        const container = this.domNode.querySelector(appendTo);

        if (container === null) {
            console.warn(`${this.name}.add() - appendTo selector not found within this component`);
            return;
        }
        
        let net = new Net();
        let html = await net.post('/componentRender', {
            component: componentName,
            data,
            attributes,
            unwrap: false
        });

        const tmpContainer = document.createElement('div');
        tmpContainer.innerHTML = html;

        const componentNode = tmpContainer.firstChild as HTMLElement;

        const component = new Component(this, componentName, componentNode, this.storeGlobal);
        this.children.push(component);

        container.appendChild(componentNode);
    }

    // query(match: Array<string>, exact: boolean = false) {
    //     this.children.reduce((prev, curr) => {
    //         if (curr.name)
    //         return prev.concat(curr)
    //     }, []);
    // }

}

export class Net {

    // Make a HTTP request
    public async request(method: RequestMethod, url: string, headers: IncomingHttpHeaders = {}, body?: any, responseType: XMLHttpRequestResponseType = 'text'): Promise<string> {
        return new Promise((resolve, reject) => {
            let xhr = new XMLHttpRequest();
    
            // listen for state change
            xhr.onreadystatechange = () => {
                if (xhr.readyState == 4) {
                    // got the response
                    resolve(xhr.responseText);
                }
            }

            // reject on error
            xhr.onerror = (err) => {
                reject(err);
            }
    
            // init request
            xhr.open(method, url);

            xhr.responseType = responseType;
            
            // set the X-Requested-With: xmlhttprequest header if not set by user
            if (! ('x-requested-with' in headers)) {
                headers['x-requested-with'] = 'xmlhttprequest';
            }

            // set request headers
            for (let header in headers) {
                let headerValue = headers[header];
                if (typeof headerValue === 'string') {
                    xhr.setRequestHeader(header, headerValue);
                } else {
                    console.warn('Only string header values are supported');
                }
            }
            
            // send the request
            xhr.send(body);
        });
    }

    public async get(url: string, headers: IncomingHttpHeaders = {}): Promise<string> {
        return this.request('GET', url, headers);
    }

    public async delete(url: string, headers: IncomingHttpHeaders = {}): Promise<string> {
        return this.request('DELETE', url, headers);
    }

    public async post(url: string, data: any, headers: IncomingHttpHeaders = {}): Promise<string> {
        if (typeof data === 'object' && ! headers['content-type']) {
            // if data is object and no content/type header is specified default to application/json
            headers['content-type'] = 'application/json';
            // convert data to JSON
            data = JSON.stringify(data);
        }
        return await this.request('POST', url, headers, data);
    }

    public async put(url: string, data: any, headers: IncomingHttpHeaders = {}): Promise<string> {
        return this.request('PUT', url, headers, data);
    }

}

export class DataStore {

    protected data: {
        [componentId: string] : {
            [key: string] : any
        }
    } = {}

    protected changeListeners: {
        [componentId: string] : {
            [key: string] : Array<StoreChangeCallback>
        }
    } = {}

    // return self to allow chained calls to set
    set(componentId: string, key: string, val: any): DataStore {
        const oldValue = this.get(componentId, key);

        if (! this.data[componentId]) {
            this.data[componentId] = {}
        }

        this.data[componentId][key] = val;
        
        if (this.changeListeners[componentId] && (this.changeListeners[componentId][key] || this.changeListeners[componentId]['*'])) {
            // there are change listeners, call them
            (this.changeListeners[componentId][key] || []).concat(this.changeListeners[componentId]['*'] || []).forEach((cb) => {
                cb(key, val, oldValue, componentId);
            });
        }

        return this;
    }

    get(componentId: string, key: string): any {
        if (! this.data[componentId]) {
            return undefined;
        }
        return this.data[componentId][key];
    }

    // add callback to be called when a given key's value is changed
    // if key === '*' then it will be called when any of the key's values is changed
    onChange(componentId: string, key: string|AsteriskAny, callback: StoreChangeCallback): DataStore {
        if (! this.changeListeners[componentId]) {
            this.changeListeners[componentId] = {}
        }
        if (! this.changeListeners[componentId][key]) {
            this.changeListeners[componentId][key] = [];
        }

        this.changeListeners[componentId][key].push(callback);
        return this;
    }
}

// Simplifies the use of data store
// it is initialized with component ID and global store so that from component
// one can set/get a value without having to pass in a component id
export class DataStoreView {

    private store: DataStore;
    private componentId: string;

    constructor(store: DataStore, componentId: string) {
        this.store = store;
        this.componentId = componentId;
    }

    set(key: string, val: any): DataStoreView {
        this.store.set(this.componentId, key, val);
        return this;
    }

    get(key: string): any {
        return this.store.get(this.componentId, key);
    }

    // add callback to be called when a given key's value is changed
    // if key === '*' then it will be called when any of the key's values is changed
    onChange(key: string|AsteriskAny, callback: StoreChangeCallback): DataStoreView {
        this.store.onChange(this.componentId, key, callback);
        return this;
    }
}

export class Client {
    Components : App = new App();
    Net : Net = new Net();
}

new App();