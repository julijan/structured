import { existsSync, readFileSync } from 'fs';
import { DocumentHead } from './DocumentHead.js';
import conf from '../../app/Config.js';
import * as path from 'path';
import { Application } from './Application.js';
import { LooseObject } from '../Types.js';
import Handlebars = require('handlebars');
const jsdom = require('jsdom');
const { JSDOM } = jsdom;

export class Document {

    head: DocumentHead;
    body: string;
    language = 'en';
    application: Application;

    constructor(app: Application, title: string) {
        this.application = app;
        this.head = new DocumentHead(title);
        this.body = '';
    }

    async loadView(pathRelative: string): Promise<boolean> {

        let viewPath = path.resolve('../' + conf.views.path + '/' + pathRelative + (pathRelative.endsWith('.html') ? '' : '.html'));

        if (! existsSync(viewPath)) {
            console.warn(`Couldn't load body of document ${this.head.title}: ${viewPath}`);
            return false;
        }

        let html = readFileSync(viewPath).toString();

        let dom = new JSDOM(html);

        await this.loadComponents(dom.window.document.body);

        this.body = dom.window.document.body.innerHTML;

        return true;
    }

    async loadComponents(scope: any): Promise<void> {
        let componentTags = this.application.components.components.map((componentEntry) => {
            return componentEntry.name;
        });

        for (let i = 0; i < componentTags.length; i++) {
            let tag = componentTags[i];
            let component = this.application.components.components.find((cmp) => {
                return cmp.name == tag;
            });
    
            if (component) {
                let componentInstances = scope.querySelectorAll(tag);
    
                for (let j = 0; j < componentInstances.length; j++) {
                    componentInstances[j].innerHTML = readFileSync(component.path).toString();

                    if (component.hasJS && component.pathJS) {
                        // get component data and fill it in
                        const componentConstructor = require(component.pathJS).default;
                        let componentInstance = new componentConstructor();
                        let data = await componentInstance.getData();
                        this.fillComponentData(componentInstances[j], data);
                    }

                    // load components recursively within just loaded component
                    await this.loadComponents(componentInstances[j]);
                }
    
            }

        }
        
        return;
    }

    fillComponentData(scope: any, data: Promise<LooseObject>): void {
        let template = Handlebars.compile(scope.innerHTML);
        scope.innerHTML = template(data);
    }

    toString(): string {
        return `<!DOCTYPE html>
        <html lang="${this.language}">
        ${this.head.toString()}
        <body>
            ${this.body}
        </body>
        </html>`;
    }

}