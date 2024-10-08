import conf from '../../app/Config.js';
import { Document } from './Document.js';
import { attributeValueFromString, attributeValueToString, toCamelCase } from '../Util.js';
import { ComponentEntry, LooseObject, RequestBodyArguments } from '../Types.js';

import { existsSync, readFileSync } from 'fs';
import * as path from 'path';
import { default as Handlebars }  from 'handlebars';
import * as jsdom from 'jsdom';
const { JSDOM } = jsdom;

export class Component {

    id: string;

    name: string;

    document: Document;
    
    parent: null|Document|Component;
    children: Array<Component> = [];

    path: Array<string> = [];

    // all attributes found on component's tag
    attributesRaw: RequestBodyArguments = {};

    // extracted from data-attribute on component tag
    attributes: Record<string, string> = {};

    dom: HTMLElement; // jsdom

    data: LooseObject = {};

    entry: null|ComponentEntry;

    isRoot: boolean;

    constructor(name: string, node?: any, parent?: Document|Component, autoInit: boolean = true) {
        this.name = name;

        if (name === 'root') {
            this.dom = new JSDOM().window.document.body;
            this.path.push('');
            this.isRoot = true;
        } else {
            this.dom = node;
            if (parent) {
                this.path = parent.path.concat(this.name);
            }
            this.isRoot = false;
        }

        if (this instanceof Document) {
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

        // register handlebars helpers
        if (! (this instanceof Document)) {
            this.document.application.helpers.applyTo(Handlebars);
        }

    }

    // load the view from file system
    public async loadView(pathRelative: string, data?: LooseObject): Promise<boolean> {

        const viewPath = path.resolve('../' + conf.views.path + '/' + pathRelative + (pathRelative.endsWith('.html') ? '' : '.html'));

        if (! existsSync(viewPath)) {
            console.warn(`Couldn't load document ${this.document.head.title}: ${viewPath}`);
            return false;
        }

        const html = readFileSync(viewPath).toString();

        await this.init(html, data);
        
        return true;
    }
    
    // load component's data and fill it
    // load any nested components recursively
    // if force is true, component will be rendered even if it has a data-if attribute
    public async init(html: string, data?: LooseObject, force: boolean = false): Promise<void> {
        // extract data-atributes
        this.attributes = this.getAttributesData();

        if (! this.attributes.if || force) {
            // no data-if
            // replace the original tag name with a div
            const div = this.dom.ownerDocument.createElement(this.entry?.renderTagName || 'div');
            div.innerHTML = html;
            if (this.dom.parentNode) {
                this.dom.parentNode.insertBefore(div, this.dom);
                this.dom.parentNode.removeChild(this.dom);
            }
            this.dom = div;

            // re-apply attributes the orignal tag had
            for (const attributeName in this.attributesRaw) {
                this.dom.setAttribute(attributeName, this.attributesRaw[attributeName].toString());
            }
        }
        
        // store initializer function on owner document
        if (this.entry?.initializer && ! this.document.initializers[this.name]) {
            this.document.initializers[this.name] = this.entry.initializer;
        }

        // set data-component="this.name" attribute on tag
        this.dom.setAttribute(conf.views.componentAttribute, this.name);

        // this.dom.setAttribute('data-component-path', this.path.join('/'));


        if (this.attributes.use && this.parent) {
            // data-use was found on component tag
            // if parent Component.data contains it, include it with data
            // set data-component-parent when a component uses parent data
            // it will be needed when the component is individually rendered
            // componentInstances[j].setAttribute('data-component-parent', parentName);
            this.attributes = Object.assign(this.importedParentData(this.parent.data) || {}, this.attributes);
        }

        if (! this.attributes.if || force) {
            // load data
            if (data === undefined) {
                if (this.entry && this.entry.module) {
                    // component has a server side part, fetch data using getData
                    this.data = (await this.entry.module.getData.apply(this, [this.attributes, this.document.ctx, this.document.application])) || {};
                } else {
                    // if the component has no server side part
                    // then use attributes as data
                    this.data = Object.assign({}, this.attributes);
                }
            }
    
            if (data !== undefined) {
                this.data = Object.assign(data, this.attributes);
            }

            // fill in before loading the components as user may output new components depending on the data
            // eg. if data is an array user may output a ListItem component using Handlebars each
            // we want those to be found as children
            this.fillData(data === undefined ? this.data : data);

            // await this.initChildren(data, force);
            await this.initChildren(undefined, force);
        }

        // allocate an unique ID for this component
        // used client side to uniquely identify the component when it accesses it's storage
        if (! this.attributes.componentId) {
            this.id = this.document.allocateId(this);
            this.dom.setAttribute('data-component-id', this.id);
        } else {
            this.id = this.attributes.componentId;
        }

        if (this.entry === undefined || this.entry?.exportData) {
            // export all data if component has no server side part
            this.setAttributes(this.data, 'data-');
        }

        if (this.entry) {
            // export specified fields if it has a server side part
            if (this.entry.exportFields) {
                this.setAttributes(this.entry.exportFields.reduce((prev, field) => {
                    prev[field] = this.data[field];
                    return prev;
                }, {} as Record<string, any>), 'data-');
            }

            // if attributes are present on component, add those to the node
            if (this.entry.attributes) {
                this.setAttributes(this.entry.attributes, '', false);
            }
        }
        
        // add style display = none to all data-if's
        // this will prevent twitching client side
        // (otherwise elements that should be hidden might appear for a brief second)
        if (this.isRoot) {
            const dataIf = this.dom.querySelectorAll<HTMLElement>('[data-if]');

            for (let i = 0; i < dataIf.length; i++) {
                dataIf[i].style.display = 'none';
            }

        }

        return;
    }

    public setAttributes(attributes: Record<string, any>, prefix: string = '', encode: boolean = true): void {
        if (typeof attributes === 'object' && attributes !== null) {
            for (const attr in attributes) {
                const value = encode ? attributeValueToString(attr, attributes[attr]) : attributes[attr];
                this.dom.setAttribute(prefix + attr, value);
            }
        }
    }

    private async initChildren(passData?: LooseObject, force: boolean = false): Promise<void> {
        const componentTags = this.document.application.components.componentNames;

        for (let i = 0; i < componentTags.length; i++) {
            const tag = componentTags[i];
            const component = this.document.application.components.components.find((cmp) => {
                return cmp.name == tag;
            });
    
            if (component) {
                const componentInstances = this.dom.querySelectorAll(tag);
    
                for (let j = 0; j < componentInstances.length; j++) {
                    const child = new Component(component.name, componentInstances[j], this, false);
                    await child.init(componentInstances[j].outerHTML, passData, force);
                    this.children.push(child);
                }
    
            }

        }
        
        return;
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

        if (this.attributes.use === null) {
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

    // parse all data-attr attributes into data object converting the data-attr to camelCase
    protected getAttributesData(domNode?: any): LooseObject {
        if (domNode === undefined) {
            domNode = this.dom;
        }
        const data: LooseObject = {}
        for (let i = 0; i < domNode.attributes.length; i++) {
            const attrNameRaw = domNode.attributes[i].name;
            const attrNameUnprefixed = this.attributeUnpreffixed(attrNameRaw);
            if (attrNameUnprefixed.indexOf('data-') === 0) {
                const attrDataType = this.attributeDataType(attrNameRaw);
                
                const dataRaw = attributeValueFromString(domNode.attributes[i].value);
                const valRaw = typeof dataRaw === 'string' ? dataRaw : dataRaw.value as string;
                const key = typeof dataRaw !== 'string' ? dataRaw.key : toCamelCase(attrNameUnprefixed.substring(5));
                let val: string|number|boolean|LooseObject|null = '';

                if (attrDataType === 'any' || attrDataType === 'string') {
                    val = valRaw;
                } else if (attrDataType === 'number') {
                    val = parseFloat(valRaw);
                } else if (attrDataType === 'boolean') {
                    val = typeof valRaw === 'string' ? valRaw === 'true' || valRaw === '1' : !!valRaw;
                } else if (attrDataType === 'object') {
                    if (typeof valRaw === 'string') {
                        if (valRaw.trim().length > 1) {
                            val = JSON.parse(valRaw);
                        } else {
                            val = null;
                        }
                    } else {
                        val = valRaw;
                    }
                }

                data[key] = val;
                
                // data-attr, convert to dataAttr and store value
                const attrData = attributeValueToString(key, val);

                domNode.setAttribute(attrNameRaw, attrData);

            }
            this.attributesRaw[domNode.attributes[i].name] = domNode.attributes[i].value;
        }
        return data;
    }

    private attributePreffix(attrName: string): string|null {
        const index = attrName.indexOf(':');
        if (index < 0) {
            return null;
        }
        return attrName.substring(0, index);
    }

    private attributeDataType(attrName: string): 'string'|'number'|'object'|'boolean'|'any' {
        const preffix = this.attributePreffix(attrName);
        if (preffix === null) {
            // no preffix
            return 'any';
        }

        if (['string', 'number', 'object', 'boolean', 'any'].includes(preffix)) {
            return preffix as 'string'|'number'|'object'|'boolean'|'any';
        }

        // unrecognized attribute preffix
        return 'any';
    }

    private attributeUnpreffixed(attrName: string): string {
        const index = attrName.indexOf(':');
        if (index < 0) {
            return attrName;
        }
        return attrName.substring(index + 1);
    }

    protected fillData(data: LooseObject): void {
        const template = Handlebars.compile(this.entry ? this.entry.html : this.dom.innerHTML);
        this.dom.innerHTML = template(data);
    }

}