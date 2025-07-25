import { ClientApplication } from './ClientApplication.js';
import { Net } from './Net.js';

export class Client {
    Components : ClientApplication = new ClientApplication();
    Net : Net = new Net();
}

new ClientApplication();