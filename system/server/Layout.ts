import { LooseObject } from '../types/general.types.js';
import { RequestContext } from "../types/request.types.js";
import { Application } from "./Application.js";
import { Component } from "./Component.js";
import { Document } from "./Document.js";

export class Layout {
    layoutComponent: string;
    app: Application;
    language: string;

    constructor(app: Application, layoutComponent: string, language: string = 'en') {
        this.app = app;
        this.layoutComponent = layoutComponent;
        this.language = language;

        // make sure the layout component exists
        if (this.app.initialized) {
            this.layoutComponentExists();
        } else {
            this.app.on('afterComponentsLoaded', () => {this.layoutComponentExists()});
        }
    }
    
    // throws an error if the layout component does not exist
    private layoutComponentExists(): void {
        if (this.app.components.getByName(this.layoutComponent) === null) {
            throw new Error(`Layout component "${this.layoutComponent}" not found`);
        }
    }

    /**
     * Creates an instance of Document, loads templateComponent into it and loads componentName into <template>
     * @param ctx RequestContext
     * @param title Page title
     * @param componentName Component name that will be loaded into <template></template>
     * @param data Optional data made available both to template and the loaded component
     * @returns Promise<Document>
     */
    async document(ctx: RequestContext, title: string, componentName: string, data?: LooseObject): Promise<Document> {
        const doc = new Document(this.app, title, ctx);
        doc.language = this.language;
        await doc.loadComponent(this.layoutComponent, data);
        const layoutComponent = doc.dom.queryByTagName('template');
        if (layoutComponent.length === 0) {
            throw new Error(`<template></template> not found in the layout component ${this.layoutComponent}`);
        }
        const component = new Component(componentName, layoutComponent[0], doc, false);
        await component.init(`<${componentName}></${componentName}>`, data);

        // add class structured-hidden to elements with data-if attribute inside <template>
        // Component already does this on root node, however, Layout component is initialized later
        const conditionals = component.dom.queryByHasAttribute('data-if');

        for (let i = 0; i < conditionals.length; i++) {
            const className = conditionals[i].getAttribute('class');
            if (typeof className === 'string') {
                // append class
                conditionals[i].setAttribute('class', `${className} structured-hidden`);
            } else {
                // add class
                conditionals[i].setAttribute('class', 'structured-hidden');
            }
        }

        return doc;
    }
}