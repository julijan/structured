import { HelperDelegate } from "handlebars";

// handlebars helper manager
export class Helpers {

    readonly helpers: Record<string, HelperDelegate> = {};

    public register(name: string, helper: HelperDelegate): void {
        this.helpers[name] = helper;
    }

    // load all helpers from given path
    public async loadFrom(path: string): Promise<void> {
        try {
            const helpers = await import(path) as {
                default?: Record<string, HelperDelegate>
            };
            if (! ('default' in helpers)) {
                throw new Error('File has no default export, expected default: Record<string, HelperDelegate>');
            }
    
            // register helper
            for (const name in helpers.default) {
                this.helpers[name] = helpers.default[name];
            }
        } catch(e) {
            throw new Error(e.message);
        }
    }

    // apply all registered helpers to given Handlebars instance
    public applyTo(handlebars: typeof Handlebars) {
        for (const name in this.helpers) {
            handlebars.registerHelper(name, this.helpers[name]);
        }
    }
}