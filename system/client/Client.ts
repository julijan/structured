
import { IncomingHttpHeaders } from 'http';
import { RequestMethod } from '../Types.js';

export class Components {

    // TODO: use config value - currently cant import Conf.ts as it would have to be exposed to client
    // which is a bad idea as it may contain sensitive data
    componentRenderURI: string = '/component';
    root: Component;
    net: Net =  new Net();

    constructor() {
        this.root = new Component(null, 'root', document.body);
    }

    // fetch a component from the server as HTML string
    public async fetch(componentName: string, primaryKey?: string|number): Promise<string> {
        return this.net.get(`${this.componentRenderURI}/${componentName}/${primaryKey || ''}`);
    }

}

export class Component {

    name: string;
    children: Array<Component> = [];
    parent: Component;
    domNode: HTMLElement;
    isRoot: boolean;
    root: Component;

    // callback executed each time the component is redrawn
    // this is the ideal place for binding any event listeners within component
    initializer : Function|null = null;

    // data-attr are parsed into an object
    data: {
        [key: string] : string
    } = {};

    constructor(parent: Component|null, name: string, domNode: HTMLElement) {
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
        this.initChildren(this.domNode, this);
    }

    // set initializer callback and execute it
    init(initializer: Function) {
        this.initializer = initializer;
        this.initializer.apply(this);
    }

    // parse all data-attr attributes into this.data object converting the data-attr to camelCase
    private initData(): void {
        for (let i = 0; i < this.domNode.attributes.length; i++) {
            if (this.domNode.attributes[i].name.indexOf('data-') === 0) {
                // data-attr, convert to dataAttr and store value
                let key = this.toCamelCase(this.domNode.attributes[i].name.substring(5));
                this.data[key] = this.domNode.attributes[i].value;
            }
        }
    }

    private toCamelCase(dataKey: string): string {
        let index: number;
        do {
            index = dataKey.indexOf('-');
            if (index > -1) {
                dataKey = dataKey.substring(0, index) + dataKey.substring(index + 1, index + 2).toUpperCase() + dataKey.substring(index + 2);
            }
        } while(index > -1);
        return dataKey;
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
                    this.children.push(new Component(parent || null, (childNode as HTMLElement).getAttribute('data-component') || '', childNode as HTMLElement));
                } else {
                    // not a component, resume from here recursively
                    this.initChildren((childNode as HTMLElement), this);
                }
            }
        }
    }

    // fetch from server and replace with new HTML
    public async redraw() {
        let net = new Net();
        let html = await net.get('/component/' + this.name + (this.data.key ? '/' + this.data.key : ''));
        this.domNode.innerHTML = html;

        // re-init children because their associated domNode is no longer part of the DOM
        // component initializers will get lost
        this.children = [];
        this.initChildren(this.domNode, this);

        // run the initializer
        if (this.initializer) {
            this.initializer();
        }
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

    // find another component within this component recursively, returns the first found component with given name
    find(componentName: string): null|Component {
        for (let i = 0; i < this.children.length; i++) {
            let child = this.children[i];
            if (child.name == componentName) {
                // found it
                return child;
            } else {
                // search recursively, if found return
                let inChild = child.find(componentName);
                if (inChild) {
                    return inChild;
                }
            }
        }
        return null;
    }

    // find another component within this component recursively, returns all found components with given name
    query(componentName: string, results: Array<Component> = []): Array<Component> {
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

    // query(match: Array<string>, exact: boolean = false) {
    //     this.children.reduce((prev, curr) => {
    //         if (curr.name)
    //         return prev.concat(curr)
    //     }, []);
    // }

}

export class Net {

    // Make a HTTP request
    public async request(method: RequestMethod, url: string, headers: IncomingHttpHeaders = {}, body?: any): Promise<string> {
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

export class Client {
    Components : Components = new Components();
    Net : Net = new Net();
}