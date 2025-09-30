import { StructuredConfig } from 'structured-fw/Types';

export const config: StructuredConfig = {
    // Application.importEnv will load all env variables starting with [envPrefix]_
    envPrefix: 'STRUCTURED',

    // whether to call Application.init when an instance of Application is created
    autoInit: true,

    url: {
        removeTrailingSlash: true,

        // if you want to enable individual component rendering set this to URI (string)
        // to disable component rendering set it to false
        // setting this to false disallows the use of ClientComponent.redraw and ClientComponent.add
        componentRender: '/componentRender',

        // function that receives the requested URL and returns boolean, if true, treat as static asset
        // if there is a registered request handler that matches this same URL, it takes precedence over this
        isAsset: function(uri: string) {
            return uri.indexOf('/assets/') === 0;
        }
    },
    routes: {
        path: '/app/routes'
    },
    components : {
        // relative to index.ts
        path: '/app/views',

        componentNameAttribute: 'structured-component'
    },
    session: {
        cookieName: 'session',
        keyLength: 24,
        durationSeconds: 60 * 60,
        garbageCollectIntervalSeconds: 60
    },
    http: {
        port: 9191,
        host: '0.0.0.0',
        // used by Document.push, can be preload or preconnect
        linkHeaderRel : 'preload'
    },
    gzip: {
        enabled: true, // whether to enable response gzip compression
        // compress only listed types
        types: [
            'text/html',
            'text/xml',
            'text/plain',
            'text/css',
            'application/javascript',
            'application/json'
        ],
        minSize: 10240, // compress only if response is at least minSize bytes
        compressionLevel: 4, // higher value = greater compression, slower
    },
    runtime: 'Node.js'
}