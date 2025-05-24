import { DOMFragment } from "./DOMFragment.js";
import { DOMNode } from "./DOMNode.js";

export class HTMLParser {

    private readonly html: string;

    private offset: number = 0;
    private context: DOMFragment | DOMNode;
    private state: 'idle' | 'tagStart' | 'tagOpen' | 'tagClose' | 'attributeName' | 'attributeValueStart' | 'attributeValue' | 'attributeEnd' | 'text' = 'idle';

    private tokenCurrent: string = '';

    private fragment: DOMFragment = new DOMFragment();

    private attributeOpenQuote: '"' | "'" = '"';
    private attributeNameCurrent: string = '';
    private attributeContext: DOMNode | null = null;

    constructor(html: string) {
        this.html = html;
        this.context = this.fragment;
        while (this.parse()) {
            // console.log({ char: this.char(), state: this.state, context: this.context.tagName });
            this.offset++;
        }
    }

    private char(): string {
        return this.html.charAt(this.offset);
    }

    private lastChar(): boolean {
        return this.offset === this.html.length - 1;
    }

    public parse(): boolean {
        if (this.offset >= this.html.length) {
            // done
            return false;
        }

        const char = this.char();
        const charCode = char.charCodeAt(0);

        if (this.state === 'idle') {
            if (char === ' ') {return true;}
            if (char === '<') {
                this.state = 'tagStart';
                this.tokenCurrent = '';
                return true;
            }
            
            // text
            this.state = 'text';
            this.tokenCurrent = char;

        } else if (this.state === 'tagStart') {
            if (char === '/') {
                this.state = 'tagClose';
                return true;
            }

            if (this.isLetter(charCode)) {
                this.state = 'tagOpen';
                this.tokenCurrent = char;
                return true;
            }
        } else if (this.state === 'tagOpen') {
            // this state means we found "<" previously and we expect to find the tag name

            if (char === '\n') {
                return true;
            }

            if (char === '/') {
                if (this.tokenCurrent.length === 0) {
                    throw this.error(`Unexpected tag closing sequence "</", expected opening tag`);
                }
                // ignore this one, it's a self closing tag, but we will expect to find ">" anyway
                return true;
            }

            if (char === '>') {
                if (this.tokenCurrent.length === 0) {
                    throw this.error(`Found an empty HTML tag <>`);
                }
                // opening tag end, create node and switch context to new node
                const node = new DOMNode(this.fragment, this.context, this.tokenCurrent);
                this.context.appendChild(node);
                this.state = 'idle';
                this.tokenCurrent = '';
                if (! node.selfClosing) {
                    this.context = node;
                }
                this.attributeContext = node;
                return true;
            }

            if (char === ' ') {
                if (this.tokenCurrent.length === 0) {
                    return true;
                }

                // encountered space after opening tag name, could be a start of attribute name
                this.state = 'attributeName';
                const node = new DOMNode(this.fragment, this.context, this.tokenCurrent);
                this.context.appendChild(node);
                this.tokenCurrent = '';
                if (! node.selfClosing) {
                    this.context = node;
                }
                this.attributeContext = node;
                return true;
            }

            if (char !== '_' && ! this.isLetter(charCode) && (this.tokenCurrent.length > 0 && ! this.isNumber(charCode))) {
                throw this.error(`Expected a-Z after HTML opening tag`);
            }

            this.tokenCurrent += char;
            return true;
        } else if(this.state === 'tagClose') {
            if (char === '/') {
                // slash before closing tag eg. <input name="..." />
                return true;
            }
            if (char === '>') {
                if (this.tokenCurrent !== this.context.tagName) {
                    throw this.error(`Found closing tag ${this.tokenCurrent}, expected ${this.context.tagName}`);
                }
                // tag closed, switch context to parent of the current context
                this.context = this.context.parentNode || this.fragment;
                this.state = 'text';
                this.tokenCurrent = '';
                return true;
            }
            this.tokenCurrent += char;
        } else if (this.state === 'text') {
            if (char === '<') {
                // end text
                this.state = 'tagStart';
                this.context.appendChild(this.tokenCurrent);
                this.tokenCurrent = '';
                return true;
            }
            this.tokenCurrent += char;

            if (this.lastChar() && this.tokenCurrent.length > 0) {
                // text within node is handled when node closing tag is found
                // this handles text that is a direct child of the fragment
                this.context.appendChild(this.tokenCurrent);
            }
        } else if (this.state === 'attributeName') {
            const boundsChar = char === ' ' || char === '\n' || char === '\t';
            if (boundsChar || char === '=' || char === '>') {
                // end of attribute name
                if (char === '=') {
                    this.state = 'attributeValueStart';
                } else if (char === '>') {
                    this.state = 'idle';
                }
                if (this.tokenCurrent.length > 0) {
                    if (this.attributeContext !== null && this.tokenCurrent.trim().length > 0) {
                        this.attributeContext.setAttribute(this.tokenCurrent, true);
                    }
                    this.attributeNameCurrent = this.tokenCurrent;
                    this.tokenCurrent = '';
                    return true;
                }
            }

            if (! boundsChar) {
                this.tokenCurrent += char;
            }
        } else if (this.state === 'attributeValueStart') {
            if (char === '"' || char === "'") {
                this.state = 'attributeValue';
                this.attributeOpenQuote = char;
                return true;
            }
        } else if (this.state === 'attributeValue') {

            if (char === this.attributeOpenQuote) {
                // attribute value ended
                if (this.attributeContext) {
                    this.attributeContext.setAttribute(this.attributeNameCurrent, this.tokenCurrent);
                }
                this.tokenCurrent = '';
                this.attributeNameCurrent = '';
                this.state = 'attributeEnd';
                return true;
            }

            this.tokenCurrent += char;
        } else if (this.state === 'attributeEnd') {
            if (char === '>') {
                this.state = 'idle';
                return true;
            } if (char === ' ' || char === '\n') {
                this.state = 'attributeName';
                return true;
            } else if (char === '/') {
                return true;
            } else {
                throw this.error(`Unexpected character ${char} after attribute value`);
            }
        }

        return true;

    }

    // returns current line
    private line(): number {
        return this.html.substring(0, this.offset).split('\n').length;
    }

    private lineChar(): number {
        return this.offset % this.html.split('\n').slice(0, this.line()).length;
    }

    private isLetter(charCode: number): boolean {
        const isLowerCase = charCode > 96 && charCode < 123;
        if (isLowerCase) {return true;}
        const isUpperCase = charCode > 64 && charCode < 91;
        if (isUpperCase) {return true;}

        return false;
    }

    private isNumber(charCode: number): boolean {
        return charCode > 47 && charCode < 58;
    }

    public dom(): DOMFragment {
        return this.fragment;
    }

    private error(message: string): Error {
        return new Error(`
        HTMLParser: ${message}
        Line ${this.line()}, col ${this.lineChar()}
        Char ${this.char()}, code ${this.char().charCodeAt(0)}
        HTML:
        ${this.html}`);
    }

}