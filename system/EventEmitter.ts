import { EventEmitterCallback } from "./Types.js";

export class EventEmitter<T extends Record<string, any> = Record<string, any>> {
    protected listeners: Partial<Record<keyof T, Array<EventEmitterCallback<any>>>> = {}

    // add event listener
    public on<K extends keyof T>(eventName: K, callback: EventEmitterCallback<T[K]>): void {
        if (! Array.isArray(this.listeners[eventName])) {
            this.listeners[eventName] = [];
        }

        this.listeners[eventName].push(callback);
    }

    // emit event with given payload
    public emit(eventName: keyof T, payload?: any): void {
        if (Array.isArray(this.listeners[eventName])) {
            this.listeners[eventName].forEach((callback) => {
                callback(payload);
            });
        }
    }

    // remove event listener
    public unbind(eventName: keyof T, callback: EventEmitterCallback<any>): void {
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