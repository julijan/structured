import { Document } from './Document.js';
import { attributeValueFromString, attributeValueToString, objectEach, toCamelCase } from '../Util.js';
import { ComponentEntry, LooseObject } from '../Types.js';
import { DOMFragment } from './dom/DOMFragment.js';
import { DOMNode } from './dom/DOMNode.js';
import { EventEmitter } from '../EventEmitter.js';

export class Component<Events extends Record<string, any> = {'componentCreated' : Component}> extends EventEmitter<Events> {
    id: string;
    name: string;
    document: Document;
    
    parent: null|Document|Component;
    children: Array<Component> = [];

    path: Array<string> = [];

    // all attributes found on component's tag
    attributesRaw: Record<string, string | true> = {};

    // extracted from data-attribute on component tag
    attributes: Record<string, string|number|boolean|LooseObject|null> = {};

    dom: DOMNode; // jsdom

    data: LooseObject = {};

    entry: null|ComponentEntry; // null for root

    isRoot: boolean;

    constructor(name: string, node?: DOMNode, parent?: Document|Component, autoInit: boolean = true) {
        super();
        const isDocument = this instanceof Document;
        this.name = name;

        if (name === 'root') {
            this.dom = new DOMFragment();
            this.path.push('');
            this.isRoot = true;
        } else {
            this.dom = node || new DOMFragment();
            if (parent) {
                this.path = parent.path.concat(this.name);
            }
            this.isRoot = false;
        }

        if (isDocument) {
            // this will only happen if an instance of Document, as it extends component
            this.document = this;
        } else {
            // component is always initialized with parent except when it is a document
            // since here we know we are not a part of Document, parent has to be a component
            if (! (parent instanceof Component)) {
                console.error('Component initialized without a parent');
            }
            this.document = (parent as Component).document;
        }

        this.parent = parent || null;

        this.id = '';

        const component = parent === undefined ? false : this.document.application.components.getByName(this.name);
        if (component) {
            // store ComponentEntry
            this.entry = component;

            if (autoInit) {
                // fill in with HTML and init children
                this.init(component.html);
            }
        } else {
            this.entry = null;
        }

        if (! isDocument) {
            this.document.emit('componentCreated', this);
        }
    }
    
    // load component's data and fill it
    // load any nested components recursively
    public async init(html: string, data?: LooseObject): Promise<void> {

        // extract data-attributes and encode non-encoded attributes
        this.initAttributesData();

        // create component container replacing the original tag name with a div
        // (or whatever is set as renderTagName on ComponentEntry)
        this.dom.tagName = this.entry?.renderTagName || 'div';

        // fill container with given HTML
        this.dom.innerHTML = html;


        // re-apply attributes the original tag had
        // no need to encode values at this point
        // any non-encoded attributes got encoded earlier by initAttributesData
        this.setAttributes(this.attributesRaw, '', false);
        
        // store initializer function on owner Document
        if (this.entry !== null && this.entry.initializer !== undefined && typeof this.document.initializers[this.name] === 'undefined') {
            this.document.initializers[this.name] = this.entry.initializer;
        }

        // set data-structured-component="this.name" attribute on tag
        this.dom.setAttribute(`data-${this.document.application.config.components.componentNameAttribute}`, this.name);

        // allocate an unique ID for this component
        // used client side to uniquely identify the component when it accesses it's storage
        if (typeof this.attributes.componentId !== 'string') {
            this.id = this.document.allocateId();
            this.dom.setAttribute('data-component-id', this.id);
        } else {
            this.id = this.attributes.componentId;
        }

        // export RequestContext.data fields specified in Application.exportedRequestContextData
        const exportedContextData = this.document.application.exportedRequestContextData.reduce((prev, field) => {
            if (! this.document.ctx) {return prev;}
            if (field in this.document.ctx.data) {
                prev[field] = this.document.ctx.data[field];
            }
            return prev;
        }, {} as Record<keyof RequestContextData, any>)
        objectEach(exportedContextData, (key, val) => {
            if (this.document.application.exportedRequestContextData.includes(key)) {
                this.setAttributes({ [key]: val }, 'data-', true);
            }
        });
        this.data = exportedContextData;

        // if component is marked as deferred (module.deferred returns true), stop here
        // ClientComponent will request a redraw as soon as it's initialized
        // setting attributes.deferred = false, to avoid looping
        if (
            this.entry !== null &&
            typeof this.entry.module !== 'undefined' &&
            typeof this.entry.module.deferred === 'function' &&
            this.entry.module.deferred(this.attributes, this.document.ctx, this.document.application) &&
            this.attributes.deferred !== false
        ) {
            this.setAttributes({deferred: true}, 'data-', true);
            return;
        }

        // load data
        const importedParentData = this.parent ? this.importedParentData(this.parent.data) : {};
        let dataServerSidePart: LooseObject = {}
        try {
            dataServerSidePart = (this.entry && this.entry.module ?
                await this.entry.module.getData(
                    Object.assign(importedParentData, this.attributes, data || {}),
                    this.document.ctx,
                    this.document.application,
                    this
                ) : {}) || {};
        } catch(e) {
            throw new Error(`Error executing getData in component ${this.name}: ${e.message}`);
        }
        if (data === undefined) {
            if (this.entry && this.entry.module) {
                // component has a server side part, fetch data using getData
                this.data = Object.assign(this.data, dataServerSidePart);
            } else {
                // if the component has no server side part
                // then use attributes as data
                this.attributes = Object.assign(importedParentData, this.attributes);
                this.data = Object.assign(this.data, this.attributes);
            }
        } else {
            this.data = Object.assign(this.data, Object.assign(importedParentData, data), this.attributes, dataServerSidePart);
        }

        // fill in before loading the components as user may output new components depending on the data
        // eg. if data is an array user may output a ListItem component using Handlebars each
        // we want those to be found as children
        this.fillData(this.data);

        if (this.entry === null || this.entry.exportData) {
            // export all data if component has no server side part
            this.setAttributes(this.data, 'data-');
        } else if (this.entry) {
            // export specified fields if it has a server side part
            if (this.entry.exportFields) {
                this.setAttributes(this.entry.exportFields.reduce((prev, field) => {
                    if (this.data[field] !== undefined) {
                        prev[field] = this.data[field];
                    }
                    return prev;
                }, {} as Record<string, any>), 'data-');
            }

            // if attributes are present on ComponentEntry, add those to the DOM node
            if (this.entry.attributes) {
                this.setAttributes(this.entry.attributes, '', false);
            }
        }
        
        await this.initChildren();

        // add style display = none to all data-if's
        // this will prevent twitching client side
        // (otherwise elements that should be hidden might appear for a brief second)
        if (this.isRoot) {
            const dataIf = this.dom.queryByHasAttribute('data-if');

            for (let i = 0; i < dataIf.length; i++) {
                dataIf[i].style.display = 'none';
            }
        }
    }

    public setAttributes(attributes: Record<string, any>, prefix: string = '', encode: boolean = true): void {
        if (typeof attributes === 'object' && attributes !== null) {
            for (const attr in attributes) {
                const encoded = typeof attributes[attr] === 'string' && attributes[attr].indexOf('base64:') === 0;
                const value = (encode && !encoded) ? attributeValueToString(attr, attributes[attr]) : attributes[attr];
                this.dom.setAttribute(prefix + attr, value);
            }
        }
    }

    private async initChildren(passData?: LooseObject): Promise<void> {
        const potentialComponents = this.dom.components();
        // const promises: Array<Promise<void>> = [];

        for (let i = 0; i < potentialComponents.length; i++) {
            const potentialComponent = potentialComponents[i];
            const component = this.document.application.components.getByName(potentialComponent.tagName);
            if (component) {
                const child = new Component(component.name, potentialComponent, this, false);
                // promises.push(child.init(childNode.outerHTML, passData));
                await child.init(potentialComponent.outerHTML, passData);
                this.children.push(child);
            }
        }

        // await Promise.all(promises);
    }

    // use string is coming from data-use attribute defined on the component
    // use string can include multiple entries separated by a coma
    // each entry can be a simple string which is the key in parent data
    // but it can also use array item access key[index] and dot notation key.subkey or a combination key[index].subkey
    protected importedParentData(parentData: LooseObject): LooseObject {
        if (! this.parent) {
            return {};
        }

        const data: LooseObject = {}

        if (typeof this.attributes.use !== 'string') {
            return data;
        }

        // split by a coma and convert into array of "data paths"
        // data path is an array of strings and numbers, and it's used to navigate the given parentData and extract a value
        const usePaths: Array<Array<string|number>> = this.attributes.use.split(',').map((key) => {
            return key.split(/\.|\[(\d+)\]/).filter((s) => {return s !== undefined && s.length > 0 }).map((s) => {
                return /^\d+$/.test(s) ? parseInt(s) : s;
            });
        });

        // try to extract data for each path
        usePaths.forEach((dataPath) => {
            let dataCurrent:any = parentData;
            for (let i = 0; i < dataPath.length; i++) {
                const segment = dataPath[i];
                if (typeof dataCurrent[segment] === 'undefined') {
                    // not included in parentData, skip
                    dataCurrent = undefined;
                    break;
                }
                dataCurrent = dataCurrent[segment];
            }

            // last segment is the key
            const dataKey = dataPath[dataPath.length - 1];

            // set the data
            data[dataKey] = dataCurrent;
        });

        if (usePaths.length == 1 && typeof usePaths[0][usePaths[0].length - 1] === 'number') {
            // if only a single import
            // and it ends with a number (indexed array) do not return { number : data }
            // instead return the data
            return data[usePaths[0][usePaths[0].length - 1]];
        }

        return data;
    }

    // fill this.attributes and this.attributesRaw using attributes found on domNode
    // encode all non-encoded attributes using attributeValueToString
    protected initAttributesData(domNode?: DOMNode): void {
        if (domNode === undefined) {
            domNode = this.dom;
        }
        for (let i = 0; i < domNode.attributes.length; i++) {
            const attrNameRaw = domNode.attributes[i].name;

            // attributes can have a data prefix eg. number:data-num="3"
            // return unprefixed attribute name
            const attrNameUnprefixed = this.attributeUnprefixed(attrNameRaw);

            if (attrNameUnprefixed.indexOf('data-') === 0) {
                // only attributes starting with data- are stored to this.attributes
                // rest are only kept in attributesRaw
                const attrDataType = this.attributeDataType(attrNameRaw);
                
                // attributes will usually be encoded using attributeValueToString, decode the value
                // using attributeValueFromString, if it was encoded dataDecoded is { key: string, value: any }
                // otherwise dataDecoded is a string
                const dataDecoded = attributeValueFromString(domNode.attributes[i].value.toString());

                // store the fact whether value was encoded, we need it later
                const valueEncoded = typeof dataDecoded === 'object';

                // value in it's raw form
                // if the value was encoded it has correct type
                // if the value was not encoded it may have incorrect type (solved later)
                let value = valueEncoded ? dataDecoded.value as string|number|boolean|LooseObject|null : dataDecoded;

                // key of encoded values is preserved as-is
                // key of non-encoded values is in-dashed-form, if so, we convert it to camel case
                const key = valueEncoded ? dataDecoded.key : toCamelCase(attrNameUnprefixed.substring(5));

                if (! valueEncoded) {
                    // value was not encoded
                    if (typeof value === 'string') {
                        // data type of value is currently string as the value was not encoded
                        // data-attr may have had a data type prefix, if so, make sure data type is restored
                        if (attrDataType === 'number') {
                            value = parseFloat(value);
                        } else if (attrDataType === 'boolean') {
                            value = value === 'true' || value === '1';
                        } else if (attrDataType === 'object') {
                            if (typeof value === 'string') {
                                if (value.trim().length > 1) {
                                    value = JSON.parse(value);
                                } else {
                                    value = null;
                                }
                            }
                        }
                    }

                    // encode attribute value using attributeValueToString
                    const attrData = attributeValueToString(key, value);
                    domNode.setAttribute(attrNameRaw, attrData);
                }

                // store value
                this.attributes[key] = value;
            }
            this.attributesRaw[attrNameRaw] = domNode.attributes[i].value;
        }
    }

    // component attributes can have a data type prefix [prefix]:data-[name]="[val]"
    // returns the prefix
    private attributePrefix(attrName: string): string|null {
        const index = attrName.indexOf(':');
        if (index < 0) {
            return null;
        }
        return attrName.substring(0, index);
    }

    // returns the user defined data type of given attribute
    // for example number:data-total returns 'number'
    private attributeDataType(attrName: string): 'string'|'number'|'object'|'boolean'|'any' {
        const prefix = this.attributePrefix(attrName);

        if (
            prefix === 'string' ||
            prefix === 'number' ||
            prefix === 'object' ||
            prefix === 'boolean'
        ) {
            return prefix;
        }

        // unrecognized attribute prefix
        return 'any';
    }

    // removes the data-type prefix from given attribute name
    // for example number:data-total returns data-total
    private attributeUnprefixed(attrName: string): string {
        const index = attrName.indexOf(':');
        if (index < 0) {
            return attrName;
        }
        return attrName.substring(index + 1);
    }

    // compile/fill in data for current component
    protected fillData(data: LooseObject): void {
        if (this.entry && this.entry.static === true) {
            // defined as static component, skip compilation
            this.dom.innerHTML = this.entry.html;
            return;
        }
        const html = this.entry ? this.entry.html : this.dom.innerHTML;
        try {
            this.dom.innerHTML = this.document.application.handlebars.compile(html, data);
        } catch(e) {
            throw new Error(`Error compiling Handlebars template in component ${this.name}, error: ${e.message}`);
        }
    }
}