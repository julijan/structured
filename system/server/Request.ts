import { RequestBodyFile, RequestBodyRecordValue } from "../Types.js";
import { mergeDeep } from "../Util.js";

export function parseBodyURLEncoded(bodyURLEncoded: string, initialValue?: Record<string, RequestBodyRecordValue> | RequestBodyRecordValue): Record<string, RequestBodyRecordValue> {
    const pairsRaw = decodeURIComponent(bodyURLEncoded.replaceAll('+', ' ')).split('&');
    const pairs: Array<{
        key: string,
        value: string,
        isArray: boolean,
        isObject: boolean,
        dataPath?: Array<string>,
        keyRaw: string
    }> = pairsRaw.map((pair) => {
        let parts = pair.split('=');
        if (parts.length > 2) {
            parts = [parts[0]].concat(parts.slice(1).join('='));
        }
        const hasValue = parts.length > 1;
        const keyRaw = hasValue ? parts[0] : pair;
        const value = hasValue ? parts[1] : '';
        const arrayOrObject = keyRaw.indexOf('[') > -1;
        const pathStart = arrayOrObject ? keyRaw.substring(keyRaw.indexOf('['), keyRaw.indexOf(']') + 1) : null;
        const isObject = pathStart !== null && /\[[^\[\]]+\]/.test(pathStart) && ! /\[\s+\]/.test(pathStart) && ! /\[\d+\]/.test(pathStart);
        const isArray = pathStart !== null && ! isObject && /\[(\d+)?\]/.test(pathStart);
        const key = isArray || isObject ? keyRaw.substring(0, keyRaw.indexOf('[')) : keyRaw;

        return {
            key,
            value,
            isArray,
            isObject,
            keyRaw
        }
    });

    const data = pairs.reduce((prev, curr) => {
        if (typeof prev[curr.key] === 'undefined') {
            // init value
            if (curr.isArray) {
                prev[curr.key] = [];
            } else if (curr.isObject) {
                prev[curr.key] = {};
            } else {
                prev[curr.key] = '';
            }
        }

        if (curr.isArray) {
            const path = curr.keyRaw.substring(curr.key.length);
            const pathKey = path.substring(1, path.indexOf(']'));
            const pathRemaining = path.substring(pathKey.length + 2);
            const nestedArray = pathRemaining.indexOf('[') > -1;
            if (! nestedArray) {
                if (pathKey.length > 0) {
                    const index = parseInt(pathKey);
                    (prev[curr.key] as Array<RequestBodyRecordValue>)[index] = curr.value;
                } else {
                    (prev[curr.key] as Array<RequestBodyRecordValue>).push(curr.value);
                }
            } else {
                // nested array
                if (typeof (prev[curr.key] as Array<RequestBodyRecordValue>)[parseInt(pathKey)] === 'undefined') {
                    (prev[curr.key] as Array<RequestBodyRecordValue>)[parseInt(pathKey)] = [];
                }
                (prev[curr.key] as Array<Array<RequestBodyRecordValue>>)[parseInt(pathKey)].push(parseBodyURLEncoded(`${pathKey}=${curr.value}`, prev[pathKey])[pathKey]);
            }
        } else if (curr.isObject) {
            const path = curr.keyRaw.substring(curr.key.length);
            const pathKey = path.substring(1, path.indexOf(']'));
            const value = parseBodyURLEncoded(`${pathKey}${path.substring(pathKey.length + 2)}=${encodeURIComponent(curr.value)}`, prev[curr.key]);
            (prev[curr.key] as Record<string, RequestBodyRecordValue>) = mergeDeep(prev[curr.key], value);
        } else {
            prev[curr.key] = curr.value;
        }

        return prev;
    }, (initialValue || {}) as Record<string, RequestBodyRecordValue>);

    return data;
}

export function parseBodyMultipart(bodyRaw: string, boundary: string) {
    const pairsRaw = bodyRaw.split(boundary);
    const pairs = pairsRaw.map((pair) => {
        const parts = /Content-Disposition: form-data; name="([^\r\n"]+)"\r\n\r\n(.*?)\r\n/.exec(pair);
        if (parts) {
            return {
                key: parts[1],
                value: parts[2]
            }
        }
        return null;
    })
    
    const urlEncoded = pairs.reduce((prev, curr) => {
        if (curr !== null) {
            prev.push(`${curr.key}=${encodeURIComponent(curr.value)}`);
        }
        return prev;
    }, [] as Array<string>).join('&');

    return parseBodyURLEncoded(urlEncoded);
}

export function multipartBodyFiles(bodyRaw: string, boundary: string) {
    const files: Record<string, RequestBodyRecordValue> = {}
    const pairsRaw = bodyRaw.split(boundary);
    pairsRaw.map((pair) => {
        const parts = /Content-Disposition: form-data; name="(.+?)"; filename="(.+?)"\r\nContent-Type: (.*)\r\n\r\n([\s\S]+)$/m.exec(pair);
        if (parts) {
            const file: RequestBodyFile = {
                data: Buffer.from(parts[4].substring(0, parts[4].length - 2).trim(), 'binary'),
                fileName: parts[2],
                type: parts[3]
            }
            mergeDeep(files, multipartFillFile(parseBodyURLEncoded(`${parts[1]}=file`), file));
        }
        return null;
    })
    return files;
}

function multipartFillFile(data: RequestBodyRecordValue, file: RequestBodyFile) {
    if (typeof data !== 'object') {return data;}
    if (Array.isArray(data)) {
        for (let i = 0; i < data.length; i++) {
            if (data[i] === 'file') {
                data[i] = file;
                return data;
            }
            if (typeof data[i] === 'object') {
                multipartFillFile(data[i] as RequestBodyRecordValue, file);
            }
        }
        return data;
    }
    for (const key in data) {
        if (data[key] === 'file') {
            data[key] = file;
            return data;
        }
        if (typeof data[key] === 'object') {
            multipartFillFile(data[key] as Record<string, RequestBodyRecordValue>, file);
        }
    }
    return data;
}