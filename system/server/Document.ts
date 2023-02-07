import { ServerResponse } from 'http';
import { Md5 } from 'ts-md5';

import { Initializers, RequestContext } from 'system/Types.js';
import conf from '../../app/Config.js';
import { Application } from './Application.js';
import { DocumentHead } from './DocumentHead.js';
import { Component } from './Component.js';
import { randomString } from '../Util.js';
import { default as Handlebars } from 'handlebars';


export class Document extends Component {

    head: DocumentHead;
    language = 'en';
    application: Application;

    initializers: Initializers = {};
    initializersInitialized: boolean = false;

    componentIds: Array<string> = [];

    ctx: undefined|RequestContext;

    constructor(app: Application, title: string, ctx?: RequestContext) {
        super('root', '');
        this.application = app;
        this.ctx = ctx;
        this.document = this;
        this.head = new DocumentHead(title);
        // include client side JS, not an actual URL, Application.ts adds a request handler
        // for routes starting with /assets/client-js/
        this.head.addJS('/assets/client-js/client/Client.js', 0, { type: 'module', defer: '' });

        // this.application.on('handlebarsRegisterHelper', async (payload: {
        //     name: string,
        //     helper: HelperDelegate
        // }) => {
        //     Handlebars.registerHelper(payload.name, payload.helper);
        // });

        this.application.handlebarsHelpers.forEach((helperItem) => {
            Handlebars.registerHelper(helperItem.name, helperItem.helper);
        });

        // include common CSS/JS
        this.application.commonJS.forEach((res) => {
            this.head.addJS(res.path, res.priority, res.attributes);
        });
        this.application.commonCSS.forEach((res) => {
            this.head.addCSS(res.path, res.priority, res.attributes);
        });
    }


    // HTTP2 push, Link headers
    push(response: ServerResponse): void {
        let resourcesJS = this.head.js.map((resource) => {
            return `<${resource.path}>; rel=${conf.http.linkHeaderRel}; as=script; crossorigin=anonymous`;
        });
        let resourcesCSS = this.head.css.map((resource) => {
            return `<${resource.path}>; rel=${conf.http.linkHeaderRel}; as=style; crossorigin=anonymous`;
        });
        let value = resourcesCSS.concat(resourcesJS).join(', ');
        response.setHeader('Link', value);
    }

    body(): string {
        return this.dom.innerHTML;
    }

    public toString(): string {

        if (! this.initializersInitialized) {
            const initializers: {
                [key: string] : string
            } = {};
    
            for (let name in this.initializers) {
                initializers[name] = this.initializers[name].toString();
            }
    
            const initializersString = '<script type="application/javascript">const initializers = ' + JSON.stringify(initializers, (key, value) => {
                return value;
            }) + '</script>';
    
            this.head.add(initializersString);
            this.initializersInitialized = true;
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

        // ideally, ID will be the MD5 sum of the component's rendered HTML
        // let id = Md5.hashStr(component.dom.outerHTML);
        let id = Md5.hashStr(`${component.name}:${component.path}:${JSON.stringify(component.attributesRaw)}`);
        
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

}