import { HelperDelegate } from "handlebars";
import { attributeValueToString, objectEach } from "./Util.js";

const helpers: Record<string, HelperDelegate> = {

    // {{{htmlTag tagName}}} outputs <tagName></tagName>
    htmlTag : function(...args) {
        // output a tag with given name
        return `<${args[0]}></${args[0]}>`;
    },

    // {{{layoutComponent componentName data}}} outputs <tagName data-use="data.key0,data.key1..."></tagName>
    layoutComponent: function(...args) {
        // output a tag with given name
        if (args.length < 2 || args.length > 4) {
            console.warn('layoutComponent expects 1 - 3 arguments (componentName, data?, attributes?) got ' + (args.length - 1));
        }

        const argsUsed = args.slice(0, args.length - 1);

        const componentName = argsUsed[0];
        const data = argsUsed[1];
        const attributes = argsUsed[2];
        const dataAttributes: Array<string> = [];
        let attributesString = '';

        if (attributes) {
            // got attributes
            if (attributes) {
                const attrNames = Object.keys(attributes);
                attributesString = attrNames.map((attrName) => {
                    const val = attributes[attrName];
                    if (typeof val === 'string' || typeof val === 'number') {
                        return `${attrName}="${val}"`
                    }
                    if (val === true) {
                        return attrName;
                    }
                    return null;
                }).filter((val) => val !== null).join(' ');
            }
        }

        if (data) {
            objectEach(data, (key, val) => {
                dataAttributes.push(`data-${key as string}="${attributeValueToString(key as string, val)}"`);
            });
        }
        
        return `<${componentName} ${dataAttributes.length > 0 ? dataAttributes.join(' ') : ''} ${attributesString}></${componentName}>`;
    },

    // JSON.stringify the given object
    json: function(...args) {
        if (args.length > 1) {
            if (typeof args[0] === 'object' && args[0] !== null) {
                return JSON.stringify(args[0]);
            }
            return '';
        }
        return '';
    },

    // used as <div {{{attr [attrName] [attrValue]}}}></div>
    // returns data-[attrName]="attributeValueToString([attrValue])"
    // valu can be of any type and will be preserved since it is encoded using attributeValueToString
    attr: function(key: string, val: any) {
        return `data-${key}="${attributeValueToString(key, val)}"`;
    },

    // converts newline characters to <br>
    nl2br: function(...args) {
        if (args.length === 1 && 'fn' in args[0]) {
            // block
            return (args[0].fn(this) || '').replaceAll('\n', '<br>');
        }
        if (args.length === 2) {
            if (typeof args[0] !== 'string') {return '';}
            return args[0].replaceAll('\n', '<br>');
        }
        return '';
    },

    // preserve indentation in given string by replacing space with &nbsp;
    indent: function(...args) {
        if (args.length === 1 && 'fn' in args[0]) {
            // block
            return args[0].fn(this).replaceAll(' ', '&nbsp;').replaceAll('\t', '&nbsp;'.repeat(4));
        }
        if (args.length === 2) {
            return args[0].replaceAll(' ', '&nbsp;').replaceAll('\t', '&nbsp;'.repeat(4));
        }
        return '';
    }
}

export default helpers;