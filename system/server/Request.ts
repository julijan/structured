import { RequestBodyRecordValue } from "../Types.js";
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
        const isObject = pathStart !== null && /\[[a-zA-Z]+\]/.test(pathStart);
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