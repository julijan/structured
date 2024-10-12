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
        const components = readdirSync(relativeToPath);
        
        components.forEach(async (component) => {
            // check if directory
            // absolute path to a directory, or the component's HTML file
            const absolutePath = relativeToPath + '/' + component;
            const isDirectory = statSync(absolutePath).isDirectory();

            if (isDirectory) {
                this.loadComponents(absolutePath);
            } else {
                // file, register component entry
                if (component.endsWith('.html')) {
                    // remove .html to get componentName
                    const componentName = component.substring(0, component.length - 5);

                    const pathAbsolute = relativeToPath || '';
                    const pathRelative = path.relative('../', pathAbsolute);
                    const pathBuild = path.resolve('../build/' + pathRelative);
                    const pathRelativeToViews = path.relative(`./${conf.views.path}`, pathRelative);

                    const pathHTML = `${pathAbsolute}/${component}`;

                    // server side js file path (may not exist)
                    const jsServerPath = `${pathBuild}/${componentName}.js`;
                    const hasServerJS = existsSync(jsServerPath);

                    // client side js file path (may not exist)
                    const jsClientPath = `${pathBuild}/${componentName}.client.js`;
                    const hasClientJS = existsSync(jsClientPath);

                    const entry: ComponentEntry = {
                        name: componentName,
                        path: {
                            absolute: pathAbsolute,
                            relative: pathRelative,
                            relativeToViews: `${pathRelativeToViews}/${component}`,
                            build: pathBuild,
                            html: pathHTML,
                            jsClient: hasClientJS ? jsClientPath : undefined,
                            jsServer: hasServerJS ? jsServerPath : undefined
                        },
                        hasJS : existsSync(jsServerPath),
                        html: this.loadHTML(absolutePath),
                        exportData: false,
                        static: false
                    }

                    // load client side initializer
                    if (hasClientJS) {
                        const initializer = await import('file:///' + jsClientPath);
                        entry.initializer = initializer.init;
                    }

                    if (hasServerJS) {
                        // load and instantiate component's module
                        const componentConstructor = await import('file:///' + entry.path.jsServer);
                        entry.module = new componentConstructor.default();

                        entry.renderTagName = entry.module?.tagName || 'div';
                        entry.exportData = typeof entry.module?.exportData === 'boolean' ? entry.module.exportData : false;
                        entry.exportFields = entry.module?.exportFields;
                        entry.attributes = entry.module?.attributes;
                        entry.static = typeof entry.module?.static === 'boolean' ? entry.module.static : false;
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