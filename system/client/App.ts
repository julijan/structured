import { DataStore } from './DataStore.js';
import { ClientComponent } from './ClientComponent.js';
import { InitializerFunction } from '../types/component.types.js';

export class App {
    root: ClientComponent;
    store: DataStore = new DataStore();
    initializers: Record<string, InitializerFunction> = {}

    constructor() {
        this.loadInitializers();
        this.root = new ClientComponent(null, 'root', document.body, this);
    }

    public getInitializer(componentName: string): InitializerFunction | null {
        if (!this.hasInitializer(componentName)) {return null;}
        return this.initializers[componentName];
    }

    private loadInitializers(): void {
        if (!!window.initializers) {
            for (const componentName in window.initializers) {
                this.registerInitializer(componentName, window.initializers[componentName])
            }
        }
    }

    public hasInitializer(componentName: string): boolean {
        return componentName in this.initializers;
    }

    public registerInitializer(componentName: string, initializerFunctionString: string): void {
        if (this.hasInitializer(componentName)) {return;}
        // create an async function using AsyncFunction constructor
        const AsyncFunction = async function () {}.constructor;
        // @ts-ignore
        const initializerFunction = new AsyncFunction(`
            const init = ${initializerFunctionString};
            if (!this.destroyed) {
                try {
                    await init.apply(this, [...arguments]);
                } catch(e) {
                    console.error('Error in component ${componentName}: ' + e.message, this);
                }
            }
        `) as InitializerFunction;

        // assign it
        this.initializers[componentName] = initializerFunction;
    }
}
