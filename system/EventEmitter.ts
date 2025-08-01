import { EventEmitterCallback } from './types/eventEmitter.types.js';

export class EventEmitter<T extends Record<string, any> = Record<string, any>> {
    protected listeners: Partial<Record<Extract<keyof T, string>, Array<EventEmitterCallback<any>>>> = {}
    protected destroyed: boolean = false;
    protected ready: boolean = false;

    // when event is emitted on EventEmitter before it is ready
    // it gets stored here in order to be emitted once EventEmitter becomes ready
    // otherwise it would miss the event
    // when a class that extends EventEmitter considers itself to receive and handle events
    // it should call emitterReady()
    private eventQueue: Array<{
        event: Extract<keyof T, string>,
        payload: any
    }> = [];

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
    public async emit(eventName: Extract<keyof T, string>, payload?: any): Promise<void> {
        if (this.destroyed) {return;}
        if (!this.ready) {
            // emitter not ready, queue event
            this.eventQueue.push({
                event: eventName,
                payload
            });
            return;
        }
        if (Array.isArray(this.listeners[eventName]) || Array.isArray(this.listeners['*'])) {
            const listeners = (this.listeners[eventName] || []).concat(this.listeners['*'] || []);
            for (let i = 0; i < listeners.length; i++) {
                await listeners[i](payload, eventName);
            }
        }
    }

    // remove event listener
    public off(eventName: keyof T, callback: EventEmitterCallback<any>): void {
        if (Array.isArray(this.listeners[eventName])) {
            const index = this.listeners[eventName].indexOf(callback);
            if (index > -1) {
                this.listeners[eventName].splice(index, 1);
            }
        }
    }

    // EventEmitter just became ready to receive events
    // mark it as ready, and execute eventQueue (events emitted on it while it was not ready)
    // clear eventQueue once done
    public async emitterReady(): Promise<void> {
        if (this.ready) {
            // already ready, nothing to do
            return;
        }
        
        // mark ready
        this.ready = true;

        // run queued events
        for (let i = 0; i < this.eventQueue.length; i++) {
            await this.emit(this.eventQueue[i].event, this.eventQueue[i].payload);
        }

        // clear queue
        this.eventQueue.length = 0;
    }

    public unbindAllListeners(): void {
        this.listeners = {}
    }

    public emitterDestroy(): void {
        this.unbindAllListeners();
        this.destroyed = true;
    }
}