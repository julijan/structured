import { AsteriskAny, StoreChangeCallback } from '../Types.js';
import { ClientComponent } from './ClientComponent.js';
import { DataStore } from './DataStore.js';

// Simplifies the use of data store
// it is initialized with component ID and global store so that from component
// one can set/get a value without having to pass in a component id

export class DataStoreView {

    private store: DataStore;
    private component: ClientComponent;

    constructor(store: DataStore, component: ClientComponent) {
        this.store = store;
        this.component = component;
    }

    public set(key: string, val: any, force: boolean = false): DataStoreView {
        this.store.set(this.component, key, val, force);
        return this;
    }

    public get(key: string): any {
        return this.store.get(this.component.componentData<string>('componentId'), key);
    }

    public toggle(key: string) {
        this.set(key, !this.get(key));
    }

    public keys(): Array<string> {
        return Object.keys(this.store.get(this.component.componentData<string>('componentId')));
    }

    // add callback to be called when a given key's value is changed
    // if key === '*' then it will be called when any of the key's values is changed
    public onChange(key: string | AsteriskAny, callback: StoreChangeCallback): DataStoreView {
        this.store.onChange(this.component.componentData<string>('componentId'), key, (key, value, oldValue, componentId) => {
            if (! this.component.destroyed) {
                // only run callback if the component is not destroyed
                callback.apply(this.component, [key, value, oldValue, componentId]);
            }
        });
        return this;
    }
}
