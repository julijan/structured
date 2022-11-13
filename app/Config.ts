const conf = {
    assets: {
        allow: function(uri: string) {
            return uri.indexOf('/assets/') === 0;
        }
    },
    views : {
        path: '/app/views',
        componentsPath: 'components'
    }
}

export default conf;