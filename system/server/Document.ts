import { existsSync, readFileSync } from 'fs';
import { DocumentHead } from './DocumentHead.js';
import conf from '../../app/Config.js';
import * as path from 'path';
import { Application } from './Application.js';
import { LooseObject, RequestBodyArguments } from '../Types.js';
import { default as Handlebars }  from 'handlebars';
import * as jsdom from 'jsdom';
import { ServerResponse } from 'http';
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
    
        await this.loadComponents(dom.window.document.body, data);
    
        this.body = dom.window.document.body.innerHTML;
        return;
    }

    private async loadComponents(scope: any, parentData?: LooseObject): Promise<void> {
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
                    // if components tag has data-use attribute data will include the keys from parentData
                    // eg. <ComponentName data-use="a, b"></ComponentName> would import a and b from parentData
                    let attributesData = this.attributesData(componentInstances[j]);

                    // whatever component.Model.getData returns
                    let componentData: any;
                    
                    if (component.hasJS && component.pathJS && component.module) {

                        if (! attributesData.key) {
                            console.warn(`Component ${component.name} has attached module but is initialized without data-key attribute.`);
                        }

                        if (attributesData.use) {
                            // data-use was found on component tag
                            // if parent data contains it, include it with data
                            attributesData = Object.assign(this.importedParentData(parentData || {}, attributesData.use), attributesData);
                        }

                        // get component data and fill it in
                        componentData = await component.module.getData(attributesData, this.application);


                        this.fillComponentData(componentInstances[j], componentData);
                    }

                    // load components recursively within just loaded component
                    await this.loadComponents(componentInstances[j], componentData);
                }
    
            }

        }
        
        return;
    }

    // use string is coming from data-use attribute defined on the component
    // use string can include multiple entries separated by a coma
    // each entry can be a simple string which is the key in parent data
    // but it can also use array item access key[index] and dot notation key.subkey or a combination key[index].subkey
    private importedParentData(parentData: LooseObject, useString: string): LooseObject {

        let data: LooseObject = {}

        // split by a coma and convert into array of "data paths"
        // data path is an array of strings and numbers, and it's used to navigate the given parentData and extract a value
        let usePaths: Array<Array<string|number>> = useString.split(',').map((key) => {
            return key.split(/\.|\[(\d+)\]/).filter((s) => {return s !== undefined && s.length > 0 }).map((s) => {
                return /^\d+$/.test(s) ? parseInt(s) : s;
            });
        });

        // try to extract data for each path
        usePaths.forEach((dataPath) => {
            let dataCurrent:any = parentData;
            for (let i = 0; i < dataPath.length; i++) {
                let segment = dataPath[i];
                if (typeof dataCurrent[segment] === 'undefined') {
                    // not included in parentData, skip
                    dataCurrent = undefined;
                    break;
                }
                dataCurrent = dataCurrent[segment];
            }

            // last segment is the key
            let dataKey = dataPath[dataPath.length - 1];

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