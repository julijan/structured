import { DOMFragment } from "./DOMFragment.js";
import { HTMLParser } from "./HTMLParser.js";

type DOMNodeAttribute = { name: string, value: string | true };

type JSONNode = {
    name: string,
    children: Array<JSONNode>,
    attributes: Record<string, DOMNodeAttribute>,
    strings: Array<string>
}

export const selfClosingTags: ReadonlyArray<string> = ['br', 'wbr', 'hr', 'input', 'img', 'link', 'meta', 'source', 'embed',
    'path', 'area', 'rect', 'ellipse', 'circle', 'line', 'polygon', 'image'
];
export const recognizedHTMLTags: ReadonlyArray<string> = [
    'body', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'b', 'i', 'a', 'em', 'strong', 'br', 'wbr', 'hr', 'abbr', 'bdi', 'bdo', 'blockquote', 'cite', 'code', 'del', 'dfn', 'ins', 'kbd', 'mark', 'pre', 'q', 'rp', 'rt', 'ruby', 's', 'samp', 'small', 'span', 'sub', 'sup', 'time', 'u', 'var', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'img', 'area', 'map', 'object', 'param', 'table', 'tr', 'td', 'th', 'caption', 'colgroup', 'col', 'form', 'input', 'label', 'select', 'option', 'textarea', 'button', 'fieldset', 'datalist', 'iframe', 'audio', 'video', 'source', 'track', 'script', 'noscript', 'div', 'nav', 'aside', 'canvas', 'embed', 'template',
    'svg', 'g', 'text', 'path', 'circle', 'clipPath', 'defs', 'ellipse', 'rect', 'polygon', 'image', 'style',
];

export class DOMNode {

    tagName: string;

    root: DOMFragment;
    parentNode: DOMNode | null = null;
    children: Array<DOMNode | string> = [];

    isRoot: boolean;

    attributes: Array<DOMNodeAttribute> = []
    attributeMap: Record<string, DOMNodeAttribute> = {}

    style: Partial<CSSStyleDeclaration> = {}

    selfClosing: boolean;
    explicitSelfClosing: boolean = false;

    // all DOMNodes are responsible for calling registerPotentialComponent if
    // their tagName is not a recognized HTML tag.
    // this is not required but should provide a big performance boost, especially in large documents
    // as we don't have to traverse the entire DOM tree to find components in Component.initChildren
    potentialComponentChildren: Array<DOMNode> = [];

    // root should always be a DOMFragment, except when the instance itself is DOMFragment
    // in which case it will be null, and this is assumed to be the root
    constructor(root: DOMFragment | null, parentNode: DOMNode | null, tagName: string) {
        this.root = root === null ? (this as unknown as DOMFragment) : root;
        this.isRoot = root === null;
        this.parentNode = parentNode;
        this.tagName = tagName;
        this.selfClosing = selfClosingTags.includes(tagName);
        if (this.isPotentialComponent()) {
            this.registerPotentialComponent(this);
        }
    }

    appendChild(node: DOMNode | string): void {
        if (typeof node !== 'string') {
            node.parentNode = this;
        }
        this.children.push(node);
    }

    setAttribute(attributeName: string, attributeValue: string | true): void {
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

    // returns true if tagName is not a recognized HTML tag
    isPotentialComponent(): boolean {
        return ! recognizedHTMLTags.includes(this.tagName.toLowerCase());
    }

    // register as potential component on parentNode
    registerPotentialComponent(node: DOMNode): void {
        if (this.parentNode !== null) {
            if (this.parentNode.isRoot || this.parentNode.isPotentialComponent()) {
                this.parentNode.potentialComponentChildren.push(node);
            } else {
                // parentNode is not a component/root
                // propagate until first component is found
                this.parentNode.registerPotentialComponent(node);
            }
        }
    }

    // returns an array of all child DOMNodes that are potentially a component
    components(): Array<DOMNode> {
        return this.potentialComponentChildren;
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
        this.potentialComponentChildren = fragment.potentialComponentChildren;
    }

    get outerHTML(): string {
        const attributes = this.attributes.reduce((attributes, attribute) => {
            attributes += ` ${attribute.name}${attribute.value === true ? '' : `="${attribute.value}"`}`;
            return attributes;
        }, '');

        const style = Object.keys(this.style).reduce((style, styleName) => {
            const styleValue = this.style[styleName as keyof CSSStyleDeclaration];
            if (styleValue?.toString().trim().length === 0) {return style};
            style += ` ${styleName}: ${styleValue};`;
            return style;
        }, '');


        return `<${this.tagName}${attributes}${style.trim().length > 0 ? ` style="${style}"` : ''}${this.explicitSelfClosing ? '/' : ''}>${this.selfClosing || this.explicitSelfClosing ? '' : `${this.innerHTML}</${this.tagName}>`}`;
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