import { PostedDataDecoded, RequestBodyFile } from "../Types.js";

export class Request {

    // process given query string into an object
    // optionally accepts initialValue
    public static queryStringDecode(queryString: string, initialValue: PostedDataDecoded = {}, trimValues: boolean = true): PostedDataDecoded {
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

                        obj[property.path] = this.queryStringDecode(objectProperties.map((prop) => {
                            const pathRemaining = prop.keyRaw.substring(prop.key.length + (prop.path?.length || 0) + 3);
                            return `value[${pathRemaining.substring(0, pathRemaining.length - 1)}]=${encodeURIComponent(prop.value)}`;
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

                        return this.queryStringDecode(objectProperties.map((prop) => {
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

    // process raw multipart/form-data body into an object
    // boundary has to be provided as second argument
    public static parseBodyMultipart(bodyRaw: string, boundary: string): PostedDataDecoded {
        const pairsRaw = bodyRaw.split(boundary);
        const pairs = pairsRaw.map((pair) => {
            const parts = /Content-Disposition: form-data; name="([^\r\n"]+)"\r?\n\r?\n([^$]+)/m.exec(pair);
            if (parts) {
                return {
                    key: parts[1],
                    value: parts[2]
                }
            }
            return null;
        });
        
        // convert data to query string
        const urlEncoded = pairs.reduce((prev, curr) => {
            if (curr !== null) {
                prev.push(`${curr.key}=${encodeURIComponent(curr.value.replaceAll('&', '%26'))}`);
            }
            return prev;
        }, [] as Array<string>).join('&');
    
        return this.queryStringDecode(urlEncoded);
    }

    public static multipartBodyFiles(bodyRaw: string, boundary: string) {
        const files: Record<string, RequestBodyFile> = {}
        const pairsRaw = bodyRaw.split(boundary);
        pairsRaw.map((pair) => {
            const parts = /Content-Disposition: form-data; name="(.+?)"; filename="(.+?)"\r\nContent-Type: (.*)\r\n\r\n([\s\S]+)$/m.exec(pair);
            if (parts) {
                const file: RequestBodyFile = {
                    data: Buffer.from(parts[4].substring(0, parts[4].length - 2).trim(), 'binary'),
                    fileName: parts[2],
                    type: parts[3]
                }
                files[parts[1]] = file;
            }
            return null;
        })
        return files;
    }
}