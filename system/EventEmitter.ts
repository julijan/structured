import { EventEmitterCallback } from './types/eventEmitter.types.js';

export class EventEmitter<T extends Record<string, any> = Record<string, any>> {
    protected listeners: Partial<Record<Extract<keyof T, string>, Array<EventEmitterCallback<any>>>> = {}
    protected destroyed: boolean = false;

    // add event listener
    public on<K extends Extract<keyof T, string>>(eventName: K, callback: EventEmitterCallback<T[K]>): void {
        if (this.destroyed) {return;}
        if (! Array.isArray(this.listeners[eventName])) {
            this.listeners[eventName] = [];
        }

        if (this.listeners[eventName].indexOf(callback) > -1) {
            // don't bind the same callback multiple times
            return;
        }

        this.listeners[eventName].push(callback);
    }

    // emit event with given payload
    public emit(eventName: Extract<keyof T, string>, payload?: any): void {
        if (this.destroyed) {return;}
        if (Array.isArray(this.listeners[eventName]) || Array.isArray(this.listeners['*'])) {
            (this.listeners[eventName] || []).concat(this.listeners['*'] || []).forEach((callback) => {
                callback(payload, eventName);
            });
        }
    }

    // remove event listener
    public off(eventName: keyof T, callback: EventEmitterCallback<any>): void {
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

    public unbindAllListeners(): void {
        this.listeners = {}
    }

    public emitterDestroy(): void {
        this.unbindAllListeners();
        this.destroyed = true;
    }
}