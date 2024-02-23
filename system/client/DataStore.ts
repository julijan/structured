import { AsteriskAny, StoreChangeCallback } from '../Types.js';
import { ClientComponent } from './ClientComponent.js';


export class DataStore {

    protected data: {
        [componentId: string]: {
            [key: string]: any;
        };
    } = {};

    protected changeListeners: {
        [componentId: string]: {
            [key: string]: Array<StoreChangeCallback>;
        };
    } = {};

    // return self to allow chained calls to set
    public set(component: ClientComponent, key: string, val: any): DataStore {
        const componentId = component.componentData<string>('componentId');

        const oldValue = this.get(componentId, key);

        if (oldValue === val) {
            return this;
        }

        if (!this.data[componentId]) {
            this.data[componentId] = {};
        }

        this.data[componentId][key] = val;

        if (this.changeListeners[componentId] && (this.changeListeners[componentId][key] || this.changeListeners[componentId]['*'])) {
            // there are change listeners, call them
            (this.changeListeners[componentId][key] || []).concat(this.changeListeners[componentId]['*'] || []).forEach((cb) => {
                cb.apply(component, [key, val, oldValue, componentId]);
            });
        }

        return this;
    }

    public get(componentId: string, key?: string): any {
        if (!this.data[componentId]) {
            return undefined;
        }
        if (typeof key !== 'string') {
            return this.data[componentId];
        }
        return this.data[componentId][key];
    }

    // add callback to be called when a given key's value is changed
    // if key === '*' then it will be called when any of the key's values is changed
    public onChange(componentId: string, key: string | AsteriskAny, callback: StoreChangeCallback): DataStore {
        if (!this.changeListeners[componentId]) {
            this.changeListeners[componentId] = {};
        }
        if (!this.changeListeners[componentId][key]) {
            this.changeListeners[componentId][key] = [];
        }

        this.changeListeners[componentId][key].push(callback);
        return this;
    }
}
