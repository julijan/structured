import { App } from './App.js';
import { Net } from './Net.js';

export class Client {
    Components : App = new App();
    Net : Net = new Net();
}

new App();