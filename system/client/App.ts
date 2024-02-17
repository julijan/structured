import { InitializerFunctionContext } from '../Types.js';
import { DataStore } from './DataStore.js';
import { Net } from './Net.js';
import { ClientComponent } from './ClientComponent.js';


export class App {
    root: ClientComponent;
    initializerContext: InitializerFunctionContext;
    store: DataStore = new DataStore();

    constructor() {
        this.root = new ClientComponent(null, 'root', document.body, this.store);

        // this is provided as an argument to each component's initializer function
        this.initializerContext = {
            net: new Net()
        };
    }
}
