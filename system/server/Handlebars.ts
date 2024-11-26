import { HelperDelegate } from "handlebars";
import { default as HandlebarsInstance }  from 'handlebars';
import { LooseObject } from "../Types.js";

// handlebars helper manager
export class Handlebars {

    readonly instance: typeof HandlebarsInstance = HandlebarsInstance;
    readonly helpers: Record<string, HelperDelegate> = {};

    // register a handlebars helper
    // registers it to this.instance and stores it to this.helpers
    // if needed later all helpers can be applied to another instance of handlebars
    public register(name: string, helper: HelperDelegate): void {
        this.helpers[name] = helper;
        this.instance.registerHelper(name, helper);
    }

    // load helpers from given path and register them
    public async loadHelpers(path: string): Promise<void> {
        try {
            const helpers = await import(path) as {
                default?: Record<string, HelperDelegate>
            };
            if (! ('default' in helpers)) {
                throw new Error('File has no default export, expected default: Record<string, HelperDelegate>');
            }
    
            // register helpers
            for (const name in helpers.default) {
                this.register(name, helpers.default[name]);
            }
        } catch(e) {
            throw new Error(e.message);
        }
    }

    // apply all registered helpers to given Handlebars instance
    public applyTo(handlebarsInstance: typeof HandlebarsInstance): void {
        for (const name in this.helpers) {
            handlebarsInstance.registerHelper(name, this.helpers[name]);
        }
    }

    // given a HTML template that uses handlebars synthax and data
    // compile and return resulting HTML
    public compile(html: string, data: LooseObject): string {
        const template = this.instance.compile(html);
        return template(data);
    }
}