import { ServerResponse } from 'node:http';

import { StructuredClientConfig } from '../types/structured.types.js';
import { LooseObject } from '../types/general.types.js';
import { Initializers } from '../types/component.types.js';
import { RequestContext } from "../types/request.types.js";
import { Application } from './Application.js';
import { DocumentHead } from './DocumentHead.js';
import { Component } from './Component.js';
import { attributeValueToString, stripBOM } from '../Util.js';
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

export class Document extends Component<{'componentCreated': Component}> {

    head: DocumentHead;
    language = 'en';
    application: Application;

    initializers: Initializers = {};
    initializersInitialized: boolean = false;

    componentIds: Array<string> = [];

    ctx: undefined|RequestContext;

    appendHTML: string = '';

    constructor(app: Application, title: string, ctx?: RequestContext) {
        super('root');
        this.application = app;
        this.ctx = ctx;
        this.document = this;
        this.head = new DocumentHead(title);

        // include client side JS, not an actual URL, Application.ts adds a request handler
        // for routes starting with /assets/client-js/
        this.head.addJS('/assets/client-js/client/Client.js', 0, { type: 'module' });

        this.application.emit('documentCreated', this);
    }


    // HTTP2 push, Link headers
    push(response: ServerResponse): void {
        const resourcesJS = this.head.js.map((resource) => {
            return `<${resource.path}>; rel=${this.application.config.http.linkHeaderRel}; as=script; crossorigin=anonymous`;
        });
        const resourcesCSS = this.head.css.map((resource) => {
            return `<${resource.path}>; rel=${this.application.config.http.linkHeaderRel}; as=style; crossorigin=anonymous`;
        });
        const value = resourcesCSS.concat(resourcesJS).join(', ');
        response.setHeader('Link', value);
    }

    body(): string {
        return this.dom.innerHTML + '\n' + this.appendHTML;
    }

    public initInitializers(): Record<string, string> {
        const initializers: {
            [key: string] : string
        } = {};

        for (const name in this.initializers) {
            initializers[name] = this.initializers[name].toString();
        }

        const initializersString = '<script type="application/javascript">window.initializers = ' + JSON.stringify(initializers) + '</script>';

        this.head.add(initializersString);
        this.initializersInitialized = true;
        return initializers;
    }

    private initClientConfig(): void {
        const clientConf: StructuredClientConfig = {
            componentRender: this.application.config.url.componentRender,
            componentNameAttribute: this.application.config.components.componentNameAttribute
        }
        const clientConfString = `<script type="application/javascript">window.structuredClientConfig = ${JSON.stringify(clientConf)}</script>`;
        this.head.add(clientConfString);
    }

    public toString(): string {

        if (! this.initializersInitialized) {
            this.initInitializers();
            this.initClientConfig();
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
    allocateId(): string {
        return randomUUID();
    }

    // load the view from file system
    public async loadView(pathRelative: string, data?: LooseObject): Promise<boolean> {
        const viewPath = path.resolve('../' + this.application.config.components.path + '/' + pathRelative + (pathRelative.endsWith('.html') ? '' : '.html'));

        if (! existsSync(viewPath)) {
            console.warn(`Couldn't load document ${this.document.head.title}: ${viewPath}`);
            return false;
        }

        const html = readFileSync(viewPath, {
            encoding: 'utf-8'
        }).toString();

        await this.init(stripBOM(html).replace(/\r/g, ''), data);
        
        return true;
    }

    // load given component into this document
    public async loadComponent(componentName: string, data?: LooseObject): Promise<void> {
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