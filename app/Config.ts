const conf = {
    envPrefix: 'STRUCTURED',
    autoInit: true,
    removeTrailingSlashURL: true,
    routes: {
        path: '/app/routes'
    },
    assets: {
        // control access to static assets
        allow: function(uri: string) {
            return uri.indexOf('/assets/') === 0;
        }
    },
    views : {
        // relative to index.ts
        path: '/app/views',

        // relative to views.path
        componentsPath: 'components',

        // whether you want to enable the specially handled URI that allows rendering individual components on the server
        // by default /component/(componentName)/(primaryKey)
        componentRenderURIEnable : true,

        // this URI is handled by Application
        // URI matching the pattern componentRenderURI/(componentName)/(primaryKey) will respond with the rendered component
        // this can be changed, but the URI arguments componentName and primaryKey must be captured with those names
        componentRenderURI : '/component'
    },
    session: {
        cookieName: 'session',
        keyLength: 24,
        durationSeconds: 60 * 60,
        garbageCollectIntervalSeconds: 60,
        garbageCollectAfterSeconds: 500
    },
    http: {
        linkHeaderRel : 'preload' // used by Document.push, can be preload or preconnect
    }
}

export default conf;