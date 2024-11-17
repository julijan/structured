import { HTMLParser } from "./HTMLParser.js";

type DOMNodeAttribute = { name: string, value: string | true };

type JSONNode = {
    name: string,
    children: Array<JSONNode>,
    attributes: Record<string, DOMNodeAttribute>,
    strings: Array<string>
}

export const selfClosingTags: ReadonlyArray<string> = ['br', 'hr', 'input', 'img', 'link', 'meta', 'source', 'embed', 'area'];

export class DOMNode {

    tagName: string;

    parentNode: DOMNode | null = null;
    children: Array<DOMNode | string> = [];

    attributes: Array<DOMNodeAttribute> = []
    attributeMap: Record<string, DOMNodeAttribute> = {}

    style: Partial<CSSStyleDeclaration> = {}

    selfClosing: boolean;

    constructor(tagName: string) {
        this.tagName = tagName;
        this.selfClosing = selfClosingTags.includes(tagName);
    }

    appendChild(node: DOMNode | string) {
        if (typeof node !== 'string') {
            node.parentNode = this;
        }
        this.children.push(node);
    }

    setAttribute(attributeName: string, attributeValue: string | true) {
        const attributeExisting = this.attributeMap[attributeName];

        if (! attributeExisting) {
            const attribute = {
                name: attributeName,
                value: attributeValue
            }
            this.attributeMap[attributeName] = attribute;
            this.attributes.push(attribute);
        } else {
            attributeExisting.value = attributeValue;
        }
    }

    hasAttribute(attributeName: string): boolean {
        return attributeName in this.attributeMap;
    }

    queryByTagName(...tagNames: Array<string>): Array<DOMNode> {
        let nodes: Array<DOMNode> = [];

        for (let i = 0; i < this.children.length; i++) {
            const child = this.children[i];
            if (typeof child === 'string') {continue;}
            if (tagNames.includes(child.tagName)) {
                nodes.push(child);
            }

            nodes = nodes.concat(child.queryByTagName(...tagNames));
        }

        return nodes;
    }

    queryByHasAttribute(...attributeNames: Array<string>): Array<DOMNode> {
        let nodes: Array<DOMNode> = [];

        for (let i = 0; i < this.children.length; i++) {
            const child = this.children[i];
            if (typeof child === 'string') {continue;}
            if (attributeNames.some((attributeName) => {
                return child.hasAttribute(attributeName)
            })) {
                nodes.push(child);
            }

            nodes = nodes.concat(child.queryByHasAttribute(...attributeNames));
        }

        return nodes;
    }

    get innerHTML(): string {
        return this.children.reduce((html, child) => {
            if (typeof child === 'string') {
                return html += child;
            } else {
                return html += child.outerHTML;
            }
        }, '') as string;
    }

    set innerHTML(html: string) {
        const fragment = new HTMLParser(html).dom();
        this.children = fragment.children;
    }

    get outerHTML(): string {
        const attributes = this.attributes.reduce((attributes, attribute) => {
            attributes += ` ${attribute.name}${attribute.value === true ? '' : `="${attribute.value}"`}`;
            return attributes;
        }, '');

        const style = Object.keys(this.style).reduce((style, styleName) => {
            const styleValue = this.style[styleName as keyof CSSStyleDeclaration];
            if (styleValue?.toString().trim().length === 0) {return style};
            style += ` ${styleName}: ${styleValue}`;
            return style;
        }, '');


        return `<${this.tagName}${attributes}${style.trim().length > 0 ? ` style=${style}` : ''}>${this.selfClosing ? '' : `${this.innerHTML}</${this.tagName}>`}`;
    }

    toObject():JSONNode {
        return {
            name: this.tagName,
            children: this.children.filter((child) => {
                return typeof child !== 'string';
            }).map((child) => {
                return child.toObject()
            }),
            attributes: this.attributeMap,
            strings: this.children.filter((child) => {
                return typeof child === 'string';
            })
        }
    }

}