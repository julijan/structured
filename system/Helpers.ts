import { HelperDelegate } from "handlebars";
import { LooseObject } from "./Types.js";
import { attributeValueToString } from "./Util.js";

const helpers: Record<string, HelperDelegate> = {

    // {{{htmlTag tagName}}} outputs <tagName></tagName>
    'htmlTag' : function(...args) {
        // output a tag with given name
        return `<${args[0]}></${args[0]}>`;
    },

    // {{{layoutComponent componentName data}}} outputs <tagName data-use="data.key0,data.key1..."></tagName>
    'layoutComponent': function(...args) {
        // output a tag with given name
        if (args.length < 2 || args.length > 4) {
            console.warn('layoutComponent expects 1 - 3 arguments (componentName, data?, attributes?) got ' + (args.length - 1));
        }

        const componentName = args[0];
        let data = {}
        let attributes: LooseObject = {};

        let useString = '';
        let attributesString = '';

        if (args.length > 2) {
            // got data
            data = args[1];
            if (data) {
                const useKeys = Object.keys(data);
                useString = useKeys.map((item) => {
                    return `data.${item}`;
                }).join(',');
            }
        }

        if (args.length > 3) {
            // got attributes
            attributes = args[2];
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
        
        return `<${componentName}${useString.length > 0 ? ` data-use="${useString}"` : ''} ${attributesString}></${componentName}>`;
    },

    // JSON.stringify the given object
    'json': function(...args) {
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
    'attr': function(key: string, val: any) {
        return `data-${key}="${attributeValueToString(key, val)}"`;
    },

    // allows conditionally rendering a string/block
    'tern' : function(...args: Array<any>) {
        if (args.length < 2) {return '';}

        const argArray = args.slice(0, args.length - 1);
        const hash = args[args.length - 1];

        const className = argArray[0];

        if (argArray.length === 1) {
            if (typeof className === 'string') {
                return className;
            }
            if (argArray[0]) {
                return hash.fn();
            }
            return '';
        }

        if (argArray.length === 2) {
            if (typeof argArray[0] === 'string') {
                if (argArray[1]) {
                    return className;
                }
                return '';
            } else {
                if (argArray[0] == argArray[1]) {
                    return hash.fn();
                }
                return '';
            }
        }

        if (argArray.length === 3) {
            if (argArray[1] == argArray[2]) {
                return className;
            }
            return '';
        }

        console.log(`Template error in helper ${hash.name}. Too many arguments, expected 1 - 3 arguments, got ${argArray.length}`);
        return '';
    },

    // converts newline characters to <br>
    'nl2br': function(...args) {
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
    'indent': function(...args) {
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