import { existsSync, readFileSync } from 'fs';
import { DocumentHead } from './DocumentHead.js';
import conf from '../../app/Config.js';
import * as path from 'path';
import { Application } from './Application.js';
import { LooseObject, RequestBodyArguments } from '../Types.js';
import { default as Handlebars }  from 'handlebars';
import * as jsdom from 'jsdom';
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

    // load the view from file system
    public async loadView(pathRelative: string, data?: LooseObject): Promise<boolean> {

        let viewPath = path.resolve('../' + conf.views.path + '/' + pathRelative + (pathRelative.endsWith('.html') ? '' : '.html'));

        if (! existsSync(viewPath)) {
            console.warn(`Couldn't load body of document ${this.head.title}: ${viewPath}`);
            return false;
        }

        let html = readFileSync(viewPath).toString();

        await this.componentInstall(html, data);
        
        return true;
    }

    // load the view providing HTML as string
    public async setView(html: string, data?: LooseObject): Promise<void> {
        await this.componentInstall(html, data);
        return;
    }
    
    // load component's data and fill it
    // load any nested components recursively
    private async componentInstall(html: string, data?: LooseObject): Promise<void> {
        let dom = new JSDOM(html);
    
        if (data !== undefined) {
            // data provided, fill in before loading the components
            this.fillComponentData(dom.window.document.body, data);
        }
    
        await this.loadComponents(dom.window.document.body);
    
        this.body = dom.window.document.body.innerHTML;
        return;
    }

    private async loadComponents(scope: any): Promise<void> {
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
                    componentInstances[j].innerHTML = component.html;

                    componentInstances[j].setAttribute(conf.views.componentAttribute, component.name);

                    // extract attributes from component's DOM node
                    // returned in format { attributeName: val }
                    // can be used to pass data down to child components
                    let attributesData = this.attributesData(componentInstances[j]);

                    if (component.hasJS && component.pathJS && component.module) {
                        // get component data and fill it in
                        let data = await component.module.getData(attributesData);
                        this.fillComponentData(componentInstances[j], data);
                    }

                    // load components recursively within just loaded component
                    await this.loadComponents(componentInstances[j]);
                }
    
            }

        }
        
        return;
    }

    // parse all data-attr attributes into data object converting the data-attr to camelCase
    private attributesData(dom: any): RequestBodyArguments {
        let data: RequestBodyArguments = {}
        for (let i = 0; i < dom.attributes.length; i++) {
            if (dom.attributes[i].name.indexOf('data-') === 0) {
                // data-attr, convert to dataAttr and store value
                let key = this.toCamelCase(dom.attributes[i].name.substring(5));
                data[key] = dom.attributes[i].value;
            }
        }
        return data;
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

    private fillComponentData(scope: any, data: LooseObject): void {
        let template = Handlebars.compile(scope.innerHTML);
        scope.innerHTML = template(data);
    }

    public toString(): string {
        return `<!DOCTYPE html>
        <html lang="${this.language}">
        ${this.head.toString()}
        <body>
            ${this.body}
        </body>
        </html>`;
    }

}