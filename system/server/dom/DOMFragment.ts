import { DOMNode } from "./DOMNode.js";

export class DOMFragment extends DOMNode {
    constructor() {
        super(null, 'body');
    }
}