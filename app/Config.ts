const conf = {
    routes: {
        path: '/app/routes'
    },
    assets: {
        allow: function(uri: string) {
            return uri.indexOf('/assets/') === 0;
        }
    },
    views : {
        path: '/app/views',
        componentsPath: 'components'
    },
    session: {
        cookieName: 'session',
        keyLength: 32,
        durationSeconds: 60 * 30,
        garbageCollectIntervalSeconds: 60
    }
}

export default conf;