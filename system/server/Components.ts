import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import * as path from 'path';
import conf from '../../app/Config.js';
import { ComponentEntry } from '../Types';

export class Components {

    components: Array<ComponentEntry> = [];
    componentNames: Array<string> = [];

    public loadComponents(relativeToPath?: string): void {
        if (relativeToPath === undefined) {
            relativeToPath = path.resolve('../' + conf.views.path + '/' + conf.views.componentsPath);
        }
        let components = readdirSync(relativeToPath);
        
        components.forEach(async (component) => {
            // check if directory
            let pathCurrent = relativeToPath + '/' + component;
            let isDirectory = statSync(pathCurrent).isDirectory();

            if (isDirectory) {
                this.loadComponents(pathCurrent);
            } else {
                // file, register component entry
                if (component.endsWith('.html')) {
                    const componentName = component.substring(0, component.length - 5);
                    // name = name.substring(0, name.length - 5);

                    // server side module
                    let jsPathRelative = path.relative(path.resolve('../'), pathCurrent);
                    let jsPath = path.resolve('../build/' + jsPathRelative);
                    jsPath = jsPath.substring(0, jsPath.length - 5) + '.js';


                    // client side initializer
                    const rel = path.relative('../', relativeToPath as string);
                    const p = path.resolve('../build', rel);
                    const initializerPath = `${p}/${componentName}.client.js`;
                    const hasInitializer = existsSync(initializerPath);
                    
                    let entry: ComponentEntry = {
                        name: componentName,
                        path: pathCurrent,
                        hasJS : existsSync(jsPath),
                        pathJS: jsPath,
                        html: this.loadHTML(pathCurrent),
                        exportData: false
                    }

                    if (hasInitializer) {
                        const initializer = await import(initializerPath);
                        entry.initializer = initializer.init;
                    }

                    if (entry.hasJS && entry.pathJS) {
                        // load and instantiate component's module
                        const componentConstructor = await import(entry.pathJS);
                        entry.module = new componentConstructor.default();

                        entry.renderTagName = entry.module?.tagName || 'div';
                        entry.exportData = entry.module?.exportData || false;
                        entry.exportFields = entry.module?.exportFields;
                    }

                    this.components.push(entry);
                    this.componentNames.push(entry.name);
                }
            }
        });
    }

    public getByName(name: string): null|ComponentEntry {
        return this.components.find((componentEntry) => {
            return componentEntry.name == name;
        }) || null;
    }

    private loadHTML(path: string): string {
        return readFileSync(path).toString();
    }

}