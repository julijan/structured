export type StructuredConfig = {
    readonly envPrefix?: string,
    readonly autoInit: boolean,
    url: {
        removeTrailingSlash: boolean;
        componentRender: false | string;
        isAsset: (url: string) => boolean;
    },
    routes: {
        readonly path: string;
    },
    components: {
        readonly path: string;
        readonly componentNameAttribute: string;
    },
    session: {
        readonly cookieName: string;
        readonly keyLength: number;
        readonly durationSeconds: number;
        readonly garbageCollectIntervalSeconds: number;
    },
    http: {
        host?: string;
        port: number;
        linkHeaderRel: 'preload' | 'preconnect';
    },
    gzip: {
        enabled: boolean,
        types: Array<string>, // mime types that should be gzipped
        minSize: number, // gzip if response is at least minSize bytes
        compressionLevel: number,
    },
    readonly runtime: 'Node.js' | 'Deno',
};

export type StructuredClientConfig = {
    componentRender: StructuredConfig['url']['componentRender'],
    componentNameAttribute: string,
};

