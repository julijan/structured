import { DocumentResource } from '../Types';

export class DocumentHead {

    title: string;
    js: Array<DocumentResource> = [];
    css: Array<DocumentResource> = [];
    custom: Array<string> = [];
    charset = 'UTF-8';

    constructor(title: string) {
        this.title = title;
    }

    public setTitle(title: string): void {
        this.title = title;
    }

    public add(str: string): void {
        this.custom.push(str);
    }

    public remove(str: string): void {
        this.custom = this.custom.filter((strExisting) => {
            return strExisting !== str;
        });
    }

    public addJS(path: string, priority: number = 0, attributes: { [ attributeName: string ] : string|null } = {}): DocumentResource {
        let resource = this.toResource(path, priority, attributes);
        this.js.push(resource);
        return resource;
    }

    public addCSS(path: string, priority: number = 0, attributes: { [ attributeName: string ] : string|null } = {}): DocumentResource {
        let resource = this.toResource(path, priority, attributes);
        this.css.push(resource);
        return resource;
    }

    public removeJS(path: string): void {
        let index = this.js.findIndex((resource) => {
            return resource.path == path;
        });
        this.js.splice(index, 1);
    }

    public removeCSS(path: string): void {
        let index = this.css.findIndex((resource) => {
            return resource.path == path;
        });
        this.css.splice(index, 1);
    }

    private toResource(path: string, priority: number = 0, attributes: { [ attributeName: string ] : string|null } = {}): DocumentResource {
        return {
            path,
            priority,
            attributes
        };
    }

    private attributesString(resource: DocumentResource): string {
        let attributesString = '';
        for (let attributeName in resource.attributes) {
            let val = resource.attributes[attributeName]
            if (val === null) {
                attributesString += ` ${attributeName}`;
            } else {
                attributesString += ` ${attributeName}="${val}"`;
            }
        }
        return attributesString;
    }

    public toString(): string {

        let css = this.css.reduce((prev, curr) => {
            return prev + '\n' + `<link rel="stylesheet" href="${curr.path}"${this.attributesString(curr)}>`;
        }, '');

        let js = this.js.reduce((prev, curr) => {
            return prev + '\n' + `<script src="${curr.path}"${this.attributesString(curr)}></script>`;
        }, '');

        let custom = this.custom.reduce((prev, curr) => {
            return prev + '\n' + curr;
        }, '');

        return `<head>
            <meta charset="${this.charset}">
            <meta http-equiv="X-UA-Compatible" content="IE=edge">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${this.title}</title>
            ${css}
            ${js}
            ${custom}
        </head>`;

    }
}
