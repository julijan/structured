import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import * as path from 'node:path';
import { ComponentEntry, StructuredConfig } from '../Types.js';
import { Application } from './Application.js';
import { stripBOM } from '../Util.js';

export class Components {

    config: StructuredConfig;

    // upper-case component name -> ComponentEntry
    private readonly components: Record<string, ComponentEntry> = {};
    componentNames: Array<string> = [];

    constructor(app: Application) {
        this.config = app.config;
    }

    public loadComponents(relativeToPath?: string): void {
        if (relativeToPath === undefined) {
            relativeToPath = path.resolve((this.config.runtime === 'Node.js' ? '../' : './') + this.config.components.path);
            if (! existsSync(relativeToPath)) {
                throw new Error(`Components path not found, expected to find:\n${relativeToPath}`);
            }
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
                    const pathRelative = path.relative(this.config.runtime === 'Node.js' ? '../' : './', pathAbsolute);
                    const pathBuild = path.resolve('./' + pathRelative);
                    const pathRelativeToViews = path.relative(`./${this.config.components.path}`, pathRelative);

                    const pathHTML = `${pathAbsolute}/${component}`;

                    // server side js file path (may not exist)
                    const jsServerPath = `${pathBuild}/${componentName}.${this.config.runtime === 'Node.js' ? 'js' : 'ts'}`;
                    const hasServerJS = existsSync(jsServerPath);

                    // client side js file path (may not exist)
                    const jsClientPath = `${pathBuild}/${componentName}.client.${this.config.runtime === 'Node.js' ? 'js' : 'ts'}`;
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
                        hasServerPart : existsSync(jsServerPath),
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
                        entry.serverPart = new componentConstructor.default();

                        entry.renderTagName = entry.serverPart?.tagName || 'div';
                        entry.exportData = typeof entry.serverPart?.exportData === 'boolean' ? entry.serverPart.exportData : false;
                        entry.exportFields = entry.serverPart?.exportFields;
                        entry.attributes = entry.serverPart?.attributes;
                        entry.static = typeof entry.serverPart?.static === 'boolean' ? entry.serverPart.static : false;
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
        const html = readFileSync(path, {
            encoding: 'utf-8'
        }).toString();
        return this.stripComments(stripBOM(html).replace(/\r/g, ''));
    }

    // remove all HTML comments
    private stripComments(html: string): string {
        return html.replaceAll(/<!--(?!-?>)(?!.*--!>)(?!.*<!--(?!>)).*?(?<!<!-)-->/g, '');
    }

}