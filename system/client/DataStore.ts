import { AsteriskAny, StoreChangeCallback } from '../Types.js';
import { equalDeep } from '../Util.js';
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
    public set(component: ClientComponent, key: string, val: any, force: boolean = false): DataStore {
        const componentId = component.getData<string>('componentId');

        const oldValue = this.get(componentId, key);

        if (! force && equalDeep({ value: oldValue }, { value: val })) {
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

    // clear data for given componentId
    public clear(componentId: string): void {
        this.data[componentId] = {};
    }

    // clear data and unbind onChange listeners for given componentId
    public destroy(componentId: string): void {
        this.unbindAll(componentId);
        this.clear(componentId);
    }

    // add callback to be called when a given key's value is changed
    // if key === '*' then it will be called when any of the key's values is changed
    public onChange(componentId: string, key: string | AsteriskAny, callback: StoreChangeCallback): DataStore {
        if (! (componentId in this.changeListeners)) {
            this.changeListeners[componentId] = {};
        }
        if (! (key in this.changeListeners[componentId])) {
            this.changeListeners[componentId][key] = [];
        }

        this.changeListeners[componentId][key].push(callback);

        return this;
    }

    // return all on change callbacks for given component
    public onChangeCallbacks(componentId: string): Record<string, Array<StoreChangeCallback>> {
        return this.changeListeners[componentId];
    }

    // unbind all onChange listeners for given component id
    private unbindAll(componentId: string): void {
        delete this.changeListeners[componentId];
    }
}
