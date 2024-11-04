import conf from "../../app/Config.js";
import { EnvConf } from "../../app/Types.js";
import { LooseObject } from "../Types.js";

export function importEnv(prefix?: string, smartPrimitives: boolean = true): EnvConf {
    const values: LooseObject = {}
    const usePrefix = typeof prefix === 'string';
    const prefixLength = usePrefix ? prefix.length : 0;
    for (const key in process.env) {
        if (! usePrefix || key.startsWith(prefix)) {
            // import
            let value: any = process.env[key];
            const keyWithoutPrefix = key.substring(prefixLength + 1);

            if (smartPrimitives) {
                if (value === 'undefined') {
                    value = undefined;
                } else if (value === 'null') {
                    value = null;
                } else if (value === 'true') {
                    value = true;
                } else if (value === 'false') {
                    value = false;
                } else if (/^-?\d+$/.test(value)) {
                    value = parseInt(value);
                } else if (/^\d+\.\d+$/.test(value)) {
                    value = parseFloat(value);
                }
            }

            values[keyWithoutPrefix] = value;
        }
    }
    return values as EnvConf;
}


export const env = importEnv(conf.envPrefix);