import { StructuredClientConfig } from './types/structured.types.ts';
import { InitializerFunction } from './types/component.types.ts';

export {}
// window.initializers will always be present
// each Document has a list of initializers used in components within it
// and they will be output as initializers = { componentName : initializer }
declare global {
    interface Window {
        initializers: Record<string, InitializerFunction | string>;
        structuredClientConfig: StructuredClientConfig;
    }
}