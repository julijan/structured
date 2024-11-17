import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import * as path from 'path';
import conf from '../../app/Config.js';
import { ComponentEntry } from '../Types';

export class Components {

    // upper-case component name -> ComponentEntry
    private readonly components: Record<string, ComponentEntry> = {};
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
                if (component.endsWith('.html') || component.endsWith('.hbs')) {
                    // remove .html to get componentName
                    const componentNameParts = component.split('.');
                    const componentName = componentNameParts.slice(0, componentNameParts.length - 1).join('.');

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

                    this.components[componentName.toUpperCase()] = entry;
                    this.componentNames.push(entry.name);
                }
            }
        });
    }

    // get component by name
    public getByName(name: string): null|ComponentEntry {
        return this.components[name.toUpperCase()] || null;
    }

    // load HTML from given path
    private loadHTML(path: string): string {
        return this.stripComments(readFileSync(path).toString());
    }

    // remove all HTML comments
    private stripComments(html: string): string {
        return html.replaceAll(/<!--(?!-?>)(?!.*--!>)(?!.*<!--(?!>)).*?(?<!<!-)-->/g, '');
    }

}