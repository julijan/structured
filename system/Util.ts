// converts string-with-dashes to stringWithDashes
export function toCamelCase(dataKey: string, separator: string = '-'): string {
    let index: number;
    do {
        index = dataKey.indexOf(separator);
        if (index > -1) {
            dataKey = dataKey.substring(0, index) + dataKey.substring(index + 1, index + 2).toUpperCase() + dataKey.substring(index + 2);
        }
    } while(index > -1);
    return dataKey;
}

// camelCase to snake_case
export function toSnakeCase(str: string, joinWith: string = '_'): string {
    let start = 0;
    const parts = [];
    if (str.length < 2) {
        return str.toLowerCase();
    }

    // split in parts at capital letters
    for (let i = 1; i < str.length; i++) {
        if (str[i] !== str[i].toLowerCase()) {
            // a capital letter
            parts.push(str.substring(start, i).toLowerCase());
            start = i;
        }
    }
    
    // didn't do anything useful
    if (start === 0) {
        return str.toLowerCase();
    }
    
    // add last part
    parts.push(str.substring(start).toLowerCase());

    return parts.join(joinWith);
}

export function capitalize(str: string) {
    return str.substring(0, 1).toUpperCase() + str.substring(1);
}

export function isAsync(fn: Function): boolean {
    return fn.constructor.name === 'AsyncFunction';
}

export function randomString(len: number): string {
    let generators = [
        // uppercase letters
        function(): string {
            return String.fromCharCode(65 + Math.floor(Math.random() * 25));
        },
        // lowercase letters
        function(): string {
            return String.fromCharCode(97 + Math.floor(Math.random() * 25));
        },
        // numbers
        function(): string {
            return String.fromCharCode(48 + Math.floor(Math.random() * 10));
        }
    ]

    let str = '';

    while (str.length < len) {
        let generator = generators[Math.floor(Math.random() * generators.length)];
        str += generator();
    }

    return str;
}

export function unique<T>(arr: Array<T>): Array<T> {
    return arr.reduce((prev, curr) => {
        if (! prev.includes(curr)) {
            prev.push(curr);
        }
        return prev;
    }, [] as Array<T>);
}

export function stripTags(contentWithHTML: string, keepTags: Array<string> = []): string {
    if (contentWithHTML === undefined) {return ''};
    return contentWithHTML.replaceAll(/<\s*\/?\s*[a-zA-Z]+[^>]*?>/g, (sub, index) => {
        const keep = keepTags.some((kept) => {
            const match = new RegExp(`^<\s*\/?\s*${kept}`);
            return match.test(sub);
        });
        if (keep) {
            return sub;
        }
        return sub.replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    });
}

function base64ToBytes(base64: string) {
    const binString = atob(base64);
    // @ts-ignore
    return Uint8Array.from(binString, (m) => m.codePointAt(0));
  }
  
function bytesToBase64(bytes: Uint8Array) {
    const binString = String.fromCodePoint(...bytes);
    return btoa(binString);
}

export function attributeValueToString(key: string, value: any): string {
    return 'base64:' + bytesToBase64(new TextEncoder().encode(JSON.stringify({key, value})));
}

export function attributeValueFromString(attributeValue: string): string|{
    key: string,
    value: any
} {

    if (attributeValue.indexOf('base64:') === 0) {
        try {
            const decoded = new TextDecoder().decode(base64ToBytes(attributeValue.substring(7)));
        
            if (decoded.indexOf('{') !== 0) {
                // expected to start with "{", if not return as is
                return attributeValue;
            }
        
            const valObj = JSON.parse(decoded);
        
            if (! ('value' in valObj) || ! ('key' in valObj)) {
                // unrecognized object
                return decoded;
            }
        
            return valObj;
    
        } catch (e) {
            return attributeValue;
        }
    }
    return attributeValue;
}

export function attributeValueEscape(str: string): string {
    return str.replaceAll('"', '&quot;');
}

export function isObject(item: any) {
    return (item && typeof item === 'object' && !Array.isArray(item));
}

export function mergeDeep(target: any, ...sources: Array<any>) {
    if (!sources.length) return target;
    const source = sources.shift();

    if (isObject(target) && isObject(source)) {
        for (const key in source) {
            if (isObject(source[key])) {
                if (!target[key]) Object.assign(target, { [key]: {} });
                mergeDeep(target[key], source[key]);
            } else {
                Object.assign(target, { [key]: source[key] });
            }
        }
    }

    if (Array.isArray(target) && Array.isArray(source)) {
        return target.concat(source);
    }

    return mergeDeep(target, ...sources);
}