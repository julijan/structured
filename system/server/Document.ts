import { ServerResponse } from 'http';
import { Md5 } from 'ts-md5';

import { Initializers, LooseObject, RequestContext } from 'system/Types.js';
import conf from '../../app/Config.js';
import { Application } from './Application.js';
import { DocumentHead } from './DocumentHead.js';
import { Component } from './Component.js';
import { attributeValueToString, randomString } from '../Util.js';
import { default as Handlebars } from 'handlebars';

export class Document extends Component {

    head: DocumentHead;
    language = 'en';
    application: Application;

    initializers: Initializers = {};
    initializersInitialized: boolean = false;

    componentIds: Array<string> = [];

    ctx: undefined|RequestContext;

    appendHTML: string = '';

    constructor(app: Application, title: string, ctx?: RequestContext) {
        super('root', '');
        this.application = app;
        this.ctx = ctx;
        this.document = this;
        this.head = new DocumentHead(title);

        // include client side JS, not an actual URL, Application.ts adds a request handler
        // for routes starting with /assets/client-js/
        this.head.addJS('/assets/client-js/client/Client.js', 0, { type: 'module' });

        this.application.helpers.applyTo(Handlebars);

        this.application.emit('documentCreated', this);
    }


    // HTTP2 push, Link headers
    push(response: ServerResponse): void {
        const resourcesJS = this.head.js.map((resource) => {
            return `<${resource.path}>; rel=${conf.http.linkHeaderRel}; as=script; crossorigin=anonymous`;
        });
        const resourcesCSS = this.head.css.map((resource) => {
            return `<${resource.path}>; rel=${conf.http.linkHeaderRel}; as=style; crossorigin=anonymous`;
        });
        const value = resourcesCSS.concat(resourcesJS).join(', ');
        response.setHeader('Link', value);
    }

    body(): string {
        return this.dom.innerHTML + '\n' + this.appendHTML;
    }

    public initInitializers() {
        const initializers: {
            [key: string] : string
        } = {};

        for (const name in this.initializers) {
            initializers[name] = this.initializers[name].toString();
        }

        const initializersString = '<script type="application/javascript">const initializers = ' + JSON.stringify(initializers) + '</script>';

        this.head.add(initializersString);
        this.initializersInitialized = true;
        return initializers;
    }

    public toString(): string {

        if (! this.initializersInitialized) {
            this.initInitializers();
        }

        return `<!DOCTYPE html>
        <html lang="${this.language}">
        ${this.head.toString()}
        <body>
            ${this.body()}
        </body>
        </html>`;
    }

    // generate an unique component id and store it to componentIds
    // so that each component within the document has an unique id
    allocateId(component: Component) {
        if (! this.componentIds) {
            // if auto initialized it may have not yet initialized it as an empty array
            this.componentIds = [];
        }

        // if component has data-id then md5(ComponentName:id), otherwise md5(ComponentName:DOM path:attributes JSON string)
        let id = Md5.hashStr(`${component.name}:${'id' in component.attributes ? component.attributes.id : `${component.path.join('/')}:${JSON.stringify(component.attributesRaw)}`}`);
        
        // but multiple components might render the exact same thing
        // so in those cases travel up the tree and append the MD5 sum of the parent
        if (this.componentIds.includes(id)) {
            let current: Component|Document|null = component.parent;

            do {
                if (current === null || current.isRoot) {
                    // reached root without being able to uniquely identify
                    // resort to a random string
                    // these components won't work as expected
                    // they will lose access to their store (client side) whenever they or their parent is redrawn
                    console.error(`Could not define an unique ID for component ${component.name}, path: ${component.path}`);
                    id = randomString(16);
                } else {
                    id += '-' + Md5.hashStr(current.dom.outerHTML);
                }
                current = current?.parent || null;
            } while(this.componentIds.includes(id));
        }

        return id;
    }

    public async loadComponent(componentName: string, data?: LooseObject) {
        const componentEntry = this.document.application.components.getByName(componentName);
        if (componentEntry) {
            const dataString = data === undefined ? '' : Object.keys(data).reduce((prev, key) => {
                prev.push(`data-${key}="${attributeValueToString(key, data[key])}"`)
                return prev;
            }, [] as Array<string>).join(' ');
            await this.init(`<${componentName} ${dataString}></${componentName}>`, data);
        }
    }

}