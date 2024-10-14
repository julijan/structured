import { DataStore } from './DataStore.js';
import { ClientComponent } from './ClientComponent.js';

export class App {
    root: ClientComponent;
    store: DataStore = new DataStore();

    constructor() {
        this.root = new ClientComponent(null, 'root', document.body, this.store);
    }
}
