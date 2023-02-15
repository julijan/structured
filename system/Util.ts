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
export function toSnakeCase(str: string): string {
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

    return parts.join('_');
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

export function attributeValueToString(key: string, value: any): string {
    return 'base64:' + btoa(JSON.stringify({key, value}));
}

export function attributeValueFromString(attributeValue: string): string|{
    key: string,
    value: any
} {

    if (attributeValue.indexOf('base64:') === 0) {
        try {
            const decoded = atob(attributeValue.substring(7));
        
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