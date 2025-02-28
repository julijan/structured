import { LooseObject, PostedDataDecoded } from "./Types.js";


// process given query string into an object
// optionally accepts initialValue
export function queryStringDecode(queryString: string, initialValue: PostedDataDecoded = {}, trimValues: boolean = true): PostedDataDecoded {
    // replace + with space and split string at & to produce key=value pairs
    const pairsRaw = queryString.replaceAll('+', ' ').split('&');

    // produce an array of {key, value, isArray, isObject, keyRaw}
    let pairs = pairsRaw.map((pair) => {

        // parts could have:
        // 1 element - key with no value
        // 2 elements - key & value
        // more than 2 elements if the value had "=" in it
        let parts = pair.split('=');
        if (parts.length > 2) {
            // value contained a "=", join all elements 1 and above with "="
            // this makes parts have exactly 2 elements (key and value)
            parts = [parts[0]].concat(parts.slice(1).join('='));
        }
        
        // part now holds 1 (key without value) or 2 elements (key and value)
        const hasValue = parts.length > 1;

        // decode key
        const keyRaw = decodeURIComponent(parts[0]);

        // if key has a value, decode it, otherwise value is true (as in, key is set)
        const value = hasValue ? (trimValues ? decodeURIComponent(parts[1]).trim() : decodeURIComponent(parts[1])) : true;

        // if key includes "[.*]" then it is an array or object
        const arrayOrObject = /\[[^\[\]]*\]/.test(keyRaw);

        // pathStart is "[.*]" or null if the key contains no [.*]
        const pathStart = arrayOrObject ? (/\[(.*?)\]/.exec(keyRaw) as RegExpExecArray)[1] : null;

        // to be an object it has to contain a string within [], otherwise it is an array
        const isObject = pathStart !== null && /[^\[\]]+/.test(pathStart) && ! /^\s+$/.test(pathStart) && ! /^\d+$/.test(pathStart);

        // it is an array if it's not an object
        const isArray = pathStart !== null && ! isObject;

        // the actual key is, if array or object - anything before "[", if not then same as keyRaw
        const key = isArray || isObject ? keyRaw.substring(0, keyRaw.indexOf('[')) : keyRaw;

        return {
            key,
            value,
            isArray,
            isObject,
            path: pathStart,
            keyRaw
        }
    });

    while (pairs.length > 0) {
        const item = pairs.shift();
        if (item) {
            if (! item.isArray && ! item.isObject) {
                // simple value
                initialValue[item.key] = item.value;
            } else if (item.isObject) {
                // object
                // return all properties of this object
                const properties = [item].concat(pairs.filter((pair) => {
                    return pair.isObject && pair.key === item.key;
                }));
                // remove properties of this same object from pairs
                pairs = pairs.filter((pair) => {
                    return ! (pair.isObject && pair.key === item.key);
                });

                let obj: Record<string, string | boolean > = {}
                const simpleProperties = properties.filter((prop) => {
                    return prop.keyRaw === `${prop.key}[${prop.path}]`;
                });
                const complexProperties = properties.filter((prop) => {
                    return prop.keyRaw !== `${prop.key}[${prop.path}]`;
                });

                // handle simple properties
                for (const property of simpleProperties) {
                    if (! property.path) {continue;}
                    obj[property.path] = property.value;
                }

                // handle complex properties
                const complexPropertyPathsResolved: Array<string> = [];
                for (const property of complexProperties) {
                    if (! property.path) {continue;}

                    // property done
                    if (complexPropertyPathsResolved.includes(property.path)) {continue;}

                    const objectProperties = complexProperties.filter((prop) => {
                        return prop.path === property.path;
                    });

                    // mark as solved
                    complexPropertyPathsResolved.push(property.path as string);

                    obj[property.path] = queryStringDecode(objectProperties.map((prop) => {
                        const pathRemaining = prop.keyRaw.substring(prop.key.length + (prop.path?.length || 0) + 3);
                        const val = prop.value === true ? '' : `=${encodeURIComponent(prop.value)}`;
                        return `value[${pathRemaining.substring(0, pathRemaining.length - 1)}]${val}`;
                    }).join('&')).value as any;
                }

                initialValue[item.key] = obj;
            } else if (item.isArray) {
                // array
                // gather values
                let arrayValues = [item].concat(pairs.filter((pair) => {
                    return pair.isArray && pair.key === item.key;
                }));
                // remove values gathered from pairs
                pairs = pairs.filter((pair) => {
                    return !(pair.isArray && pair.key === item.key);
                });

                // order the array values, this only has effect if it is an ordered array (arr[0]=val&arr[1]=val)
                arrayValues.sort((a, b) => {
                    if (a.path === b.path) {return 0;}
                    if (a.path && b.path && a.path.trim().length > 0 && b.path.trim().length > 0) {
                        const aIndex = parseInt(a.path);
                        const bIndex = parseInt(b.path);
                        return aIndex - bIndex;
                    }

                    return 0;
                });

                // arrayValues is either filled with simple values, or filled with object properties
                const complexPropertyPathsResolved: Array<string> = [];
                const arrayItems = arrayValues.map((value) => {
                    const simpleValue = value.keyRaw === `${value.key}[${value.path}]`;
                    if (simpleValue) {
                        return value.value;
                    }
                    // complex value (object)
                    if (complexPropertyPathsResolved.includes(value.path as string)) {
                        // already solved
                        return null;
                    }
                    const objectProperties = arrayValues.filter((prop) => {
                        return prop.path === value.path;
                    });
                    
                    // mark as solved
                    complexPropertyPathsResolved.push(value.path as string);

                    return queryStringDecode(objectProperties.map((prop) => {
                        const pathRemaining = prop.keyRaw.substring(prop.key.length + (prop.path?.length || 0) + 3);
                        return `value${pathRemaining.length > 0 ? `[${pathRemaining.substring(0, pathRemaining.length - 1)}]` : ''}=${encodeURIComponent(prop.value)}`;
                    }).join('&')).value as PostedDataDecoded;
                }).filter((val) => {
                    return val !== null;
                });

                // console.log(arrayValues);

                initialValue[item.key] = arrayItems;
            }
        }
    }

    return initialValue;
}

// sometimes we want to use queryStringDecode simply to parse a complex query string
// with nested keys into an object, with intent to assign a non-primitive value to it later
// for example decoding "obj[nested][key]" would produce { obj: { nested: { key: true } } }
// we might want to set the "key" to something other than true, or another primitive value
// so doing obj[nested][key]=[desiredValue] is impossible
// as the type of the value can't be coerced to string
// this function takes an object produced by queryStringDecode or a query string itself
// and the value to be populated, populates the key with value = true with given value
// and returns the populated object
export function queryStringDecodedSetValue(obj: PostedDataDecoded | string, value: any): LooseObject {
    // obj given as string, decode it first to PostedDataDecoded
    if (typeof obj === 'string') {
        obj = queryStringDecode(obj);
    }
    
    // obj is either { key: true } or a nested object eventually ending with a value = true
    // replace true with given value
    // recursively search the object and find value = true, replace it with given file
    const setValue = (obj: LooseObject) => {
        for (const key in obj) {
            if (typeof obj[key] === 'object' && obj[key] !== null) {
                // not here, resume recursively
                setValue(obj[key]);
            } else if (obj[key] === true) {
                // found the place for the file, populate it
                obj[key] = value;
            }
        }
    }

    setValue(obj);
    return obj;
}

// loop through given object, for each key, runs callbackEach providing the key and value to it
// this is a basic for ... in loop, but makes it more TS friendly
// object keys are always a string according to TS, which requires type casting
export function objectEach<T>(obj: T, callbackEach: (key: keyof T, value: T[keyof T]) => void): void {
    for (const key in obj) {
        callbackEach(key, obj[key]);
    }
}

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

export function capitalize(str: string): string {
    return str.substring(0, 1).toUpperCase() + str.substring(1);
}

export function isAsync(fn: Function): boolean {
    return fn.constructor.name === 'AsyncFunction';
}

export function randomString(len: number): string {
    const charCodes: Uint8Array = new Uint8Array(len);
    const generators = [
        // uppercase letters
        function(): number {
            return 65 + Math.floor(Math.random() * 26);
        },
        // lowercase letters
        function(): number {
            return 97 + Math.floor(Math.random() * 26);
        },
        // numbers
        function(): number {
            return 48 + Math.floor(Math.random() * 10);
        }
    ];

    for (let i = 0; i < len; i++) {
        charCodes[i] = generators[Math.floor(Math.random() * generators.length)]();
    }

    return String.fromCodePoint(...charCodes);
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
    return btoa(bytes.reduce((prev, curr) => {
        return prev + String.fromCharCode(curr);
    }, ''));
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
        
            if (!('key' in valObj)) {
                // unrecognized object
                // object encoded using attributeValueToString will always have the "key" property
                // "value" property is also always present except when value is undefined
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

export function isObject(item: any): boolean {
    if (typeof window === 'undefined') {
        return (item && typeof item === 'object' && !Array.isArray(item)) && ! Buffer.isBuffer(item);
    }
    return (item && typeof item === 'object' && !Array.isArray(item));
}

// deep comparison of 2 objects
export function equalDeep(a: LooseObject, b: LooseObject): boolean {
    if (a === b) {
        // same object
        return true;
    }

    const keysA = Object.keys(a);
    const keysB = Object.keys(b);

    if (keysA.length !== keysB.length) {
        // key count different, not same
        return false;
    }

    // same number of keys
    const keyDifferent = keysA.some((keyA) => {
        return ! (keyA in b);
    });

    if (keyDifferent) {
        // some of the keys are different, not same
        return false;
    }

    // objects have the same keys, make sure values are also the same
    for (let i = 0; i < keysA.length; i++) {
        const key = keysA[i];
        const valA = a[key];
        const valB = b[key];
        const typeA = typeof valA;
        const typeB = typeof valB;

        if (valA === valB) {
            // same value, continue
            continue;
        }

        if (typeA !== typeB) {
            // value type different, not same
            return false;
        } else {
            // same type, if primitive, compare values
            if (typeA !== 'object') {
                if (valA !== valB) {
                    return false;
                }
            }
        }

        // values have the same type, if they were exact same they would already pass this iteration
        // at this point primitives have been compared in the first check in the iteration
        // both types should be "object" at this point (object, array or null)
        // null is also an object, make sure either both are null, or none is null
        if ((valA === null && valB !== null) || (valA !== null && valB === null)) {
            // one is null, other is not
            return false;
        }

        
        // make sure either both are array, or none is array
        const isArrayA = Array.isArray(valA);
        const isArrayB = Array.isArray(valB);
        if ((isArrayA && ! isArrayB) || (! isArrayA && isArrayB)) {
            // one is array, other is not
            return false;
        }

        // at this point both values are either array or object
        if (! isArrayA && ! isArrayB) {
            // neither is an array, both are objects
            // pass the values through equalsDeep, if not the same, objects are not the same either
            if (! equalDeep(valA, valB)) {
                return false;
            }
        }

        if (isArrayA && isArrayB) {
            // both are arrays
            if (valA.length !== valB.length) {
                // arrays of different length
                return false;
            }


            for (let j = 0; j < valA.length; j++) {
                if (! equalDeep({
                    value: valA[j]
                }, {
                    value: valB[j]
                })) {
                    // different value at index, not the same array, objects not same
                    return false;
                }
            }
        }
    }

    // all checks passed, same objects
    return true;
}

export function mergeDeep(target: any, ...sources: Array<any>): LooseObject {
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

// remove BOM char if included
export function stripBOM(str: string): string {
    const includesBOM = str.charCodeAt(0) === 0xFEFF;
    return includesBOM ? str.slice(1) : str;
}