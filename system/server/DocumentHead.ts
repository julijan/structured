import { DocumentResource } from '../Types';

export class DocumentHead {

    title: string;
    js: Array<DocumentResource>;
    css: Array<DocumentResource>;
    charset = 'UTF-8';

    constructor(title: string) {
        this.title = title;
        this.js = [];
        this.css = [];
    }

    setTitle(title: string): void {
        this.title = title;
    }

    addJS(path: string, priority: number = 0): DocumentResource {
        let resource = this.toResource(path, priority);
        this.js.push(resource);
        return resource;
    }

    addCSS(path: string, priority: number = 0): DocumentResource {
        let resource = this.toResource(path, priority);
        this.css.push(resource);
        return resource;
    }

    removeJS(path: string): void {
        let index = this.js.findIndex((resource) => {
            return resource.path == path;
        });
        this.js.splice(index, 1);
    }

    removeCSS(path: string): void {
        let index = this.css.findIndex((resource) => {
            return resource.path == path;
        });
        this.css.splice(index, 1);
    }

    toResource(path: string, priority: number): DocumentResource {
        return {
            path,
            priority
        };
    }

    toString(): string {

        let css = this.css.reduce((prev, curr) => {
            return prev + '\n' + `<link rel="stylesheet" href="${curr.path}">`;
        }, '');

        let js = this.js.reduce((prev, curr) => {
            return prev + '\n' + `<script src="${curr.path}"></script>`;
        }, '');

        return `<head>
            <meta charset="${this.charset}">
            <meta http-equiv="X-UA-Compatible" content="IE=edge">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${this.title}</title>
            ${css}
            ${js}
        </head>`;

    }
}
