import { AsteriskAny, StoreChangeCallback } from '../Types.js';
import { ClientComponent } from './ClientComponent.js';
import { DataStore } from './DataStore.js';

// Simplifies the use of data store
// it is initialized with component ID and global store so that from component
// one can set/get a value without having to pass in a component id

export class DataStoreView {

    private store: DataStore;
    private component: ClientComponent;
    private destroyed = false;

    constructor(store: DataStore, component: ClientComponent) {
        this.store = store;
        this.component = component;
    }

    public set(key: string, val: any, force: boolean = false): DataStoreView {
        if (! this.destroyed) {
            this.store.set(this.component, key, val, force);
        }
        return this;
    }

    public get(key: string): any {
        if (this.destroyed) {return undefined;}
        return this.store.get(this.componentId(), key);
    }

    public toggle(key: string) {
        this.set(key, !this.get(key));
    }

    public keys(): Array<string> {
        if (this.destroyed) {return [];}
        return Object.keys(this.store.get(this.componentId()));
    }

    // clear data for owner component
    public clear() {
        this.store.clear(this.componentId());
    }

    // clear data and unbind onChange listeners for owner component
    // mark this instance as destroyed so it no longer accepts any input
    public destroy() {
        this.store.destroy(this.componentId());
        this.destroyed = true;
    }

    // return owner component id
    private componentId(): string {
        return this.component.getData<string>('componentId');
    }

    // add callback to be called when a given key's value is changed
    // if key === '*' then it will be called when any of the key's values is changed
    public onChange(key: string | AsteriskAny, callback: StoreChangeCallback): DataStoreView {
        if (this.destroyed) {return this;}
        this.store.onChange(this.componentId(), key, callback);
        return this;
    }

    // return all onChange listeners for the owner component
    public onChangeCallbacks(): Record<string, Array<StoreChangeCallback>> {
        return this.store.onChangeCallbacks(this.componentId());
    }
}
