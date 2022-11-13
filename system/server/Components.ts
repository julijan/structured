import { existsSync, readdirSync, statSync } from 'fs';
import * as path from 'path';
import conf from '../../app/Config.js';
import { ComponentEntry } from '../Types';

export class Components {

    components: Array<ComponentEntry> = [];

    loadComponents(relativeToPath?: string): void {
        if (relativeToPath === undefined) {
            relativeToPath = path.resolve('../' + conf.views.path + '/' + conf.views.componentsPath);
        }
        let components = readdirSync(relativeToPath);
        
        components.forEach((component) => {
            // check if directory
            let pathCurrent = relativeToPath + '/' + component;
            let isDirectory = statSync(pathCurrent).isDirectory();

            if (isDirectory) {
                this.loadComponents(pathCurrent);
            } else {
                // file, register component entry
                if (component.endsWith('.html')) {
                    let jsPathRelative = path.relative(path.resolve('../'), pathCurrent);
                    let jsPath = path.resolve('../build/' + jsPathRelative);
                    jsPath = jsPath.substring(0, jsPath.length - 5) + '.js';
                    
                    let componentName = component.substring(0, component.length - 5);

                    let entry: ComponentEntry = {
                        name: componentName,
                        path: pathCurrent,
                        hasJS : existsSync(jsPath),
                        pathJS: jsPath
                    }
                    this.components.push(entry);
                }
            }
        });
    }

}