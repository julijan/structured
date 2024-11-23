import { StructuredConfig } from "../system/Types.js";

const conf: StructuredConfig = {
    // system/Environment will load all env variables starting with envPrefix
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
    views : {
        // relative to index.ts
        path: '/app/views',

        // relative to views.path
        componentsPath: ''
    },
    session: {
        cookieName: 'session',
        keyLength: 24,
        durationSeconds: 60 * 60,
        garbageCollectIntervalSeconds: 60,
        garbageCollectAfterSeconds: 500
    },
    http: {
        // used by Document.push, can be preload or preconnect
        linkHeaderRel : 'preload'
    }
}

export default conf;