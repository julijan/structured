import { EventEmitterCallback } from "./Types.js";

export class EventEmitter {
    protected listeners: Record<string, Array<EventEmitterCallback>> = {}

    // add event listener
    public on(eventName: string, callback: EventEmitterCallback): void {
        if (! Array.isArray(this.listeners[eventName])) {
            this.listeners[eventName] = [];
        }

        this.listeners[eventName].push(callback);
    }

    // emit event with given payload
    public emit(eventName: string, payload?: any): void {
        if (Array.isArray(this.listeners[eventName])) {
            this.listeners[eventName].forEach((callback) => {
                callback(payload);
            });
        }
    }

    // remove event listener
    public unbind(eventName: string, callback: EventEmitterCallback): void {
        if (Array.isArray(this.listeners[eventName])) {
            while (true) {
                const index = this.listeners[eventName].indexOf(callback);
                if (index > -1) {
                    this.listeners[eventName].splice(index, 1);
                } else {
                    // callback not found, all removed
                    break;
                }
            }
        }
    }
}