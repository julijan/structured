import { DocumentResource } from '../Types';

export class DocumentHead {

    title: string;
    js: Array<DocumentResource> = [];
    css: Array<DocumentResource> = [];
    custom: Array<string> = [];
    charset = 'UTF-8';

    favicon: {
        image: string|null,
        type: string
    } = {
        image: null,
        type: 'image/png'
    }

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
        const resource = this.toResource(path, priority, attributes);
        this.js.push(resource);
        return resource;
    }

    public addCSS(path: string, priority: number = 0, attributes: { [ attributeName: string ] : string|null } = {}): DocumentResource {
        const resource = this.toResource(path, priority, attributes);
        this.css.push(resource);
        return resource;
    }

    public removeJS(path: string): void {
        const index = this.js.findIndex((resource) => {
            return resource.path == path;
        });
        this.js.splice(index, 1);
    }

    public removeCSS(path: string): void {
        const index = this.css.findIndex((resource) => {
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
        for (const attributeName in resource.attributes) {
            const val = resource.attributes[attributeName]
            if (val === null) {
                attributesString += ` ${attributeName}`;
            } else {
                attributesString += ` ${attributeName}="${val}"`;
            }
        }
        return attributesString;
    }

    public toString(): string {

        const css = this.css.reduce((prev, curr) => {
            return prev + '\n' + `<link rel="stylesheet" href="${curr.path}"${this.attributesString(curr)}>`;
        }, '');

        const js = this.js.reduce((prev, curr) => {
            return prev + '\n' + `<script src="${curr.path}"${this.attributesString(curr)}></script>`;
        }, '');

        const custom = this.custom.reduce((prev, curr) => {
            return prev + '\n' + curr;
        }, '');

        return `<head>
            <meta charset="${this.charset}">
            <meta http-equiv="X-UA-Compatible" content="IE=edge">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${this.title}</title>
            <link rel="icon" type="${this.favicon.type}" href="${this.favicon.image}">
            ${css}
            ${js}
            ${custom}
        </head>`;

    }

    public setFavicon(faviconPath: string|{
        image: string|null,
        type: string
    }): void {
        if (typeof faviconPath === 'string') {
            this.favicon = {
                image: faviconPath,
                type: this.faviconType(faviconPath)
            }
            return;
        }
        // favicon given as object
        if (faviconPath.type === '') {
            // detect type
            faviconPath.type = faviconPath.image ? this.faviconType(faviconPath.image) : 'image/png';
        }
        this.favicon = faviconPath;
    }

    private faviconType(file: string): string {
        let ext: RegExpExecArray|string|null = /\.([^.]+)$/.exec(file);
        let type = 'image/png';
        if (ext !== null) {
            ext = ext[1].toLowerCase();
            const types: {
                [key: string] : string
            } = {
                'png' : 'image/png',
                'jpg' : 'image/jpeg',
                'jpeg' : 'image/jpeg',
                'gif' : 'image/gif',
                'ico' : 'image/x-icon'
            }
            if (types[ext]) {
                type = types[ext];
            }
        }
        return type;
    }
}
