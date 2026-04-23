import { IncomingMessage, ServerResponse } from "node:http";
import { LooseObject, PostedDataDecoded, RequestBodyFile, RequestBodyRecordValue, RequestCallback, RequestHandler, URIArguments, URISegmentPattern } from "../Types.js";
import { Application } from "./Application.js";
import zlib from "node:zlib";
import { mergeDeep, queryStringDecode, queryStringDecodedSetValue } from "../Util.js";
import { Document } from "./Document.js";
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { Layout } from "./Layout.js";

export class RequestContext<Body extends LooseObject | undefined = LooseObject> {

	readonly app: Application;

	uri: string;

    private readonly pageNotFoundCallback: RequestCallback<void | Document, LooseObject | undefined>;
    private readonly handler: RequestHandler | null;
    
	readonly request: IncomingMessage;
	readonly response: ServerResponse;
	args: URIArguments = {};
	

	cookies: Record<string, string> = {};

	// POSTed data, parsed to object
	body: Body;
	bodyRaw?: Buffer;

	// files extracted from request body
	// currently only multipart/form-data
	files?: Record<string, RequestBodyRecordValue>;

	// RequestContext.data is place for user defined data
	// it is initialized as an empty object here and
	// potentially falsely declared as RequestContextData
	// user will fill this out, usually on beforeRequestHandler
	data: RequestContextData = {};

	// if session is started and user has visited any page
	sessionId?: string;

	getArgs: PostedDataDecoded = {};

	readonly timeStart: number;

	constructor(
		app: Application,
		request: IncomingMessage,
		response: ServerResponse,
		handler: RequestHandler | null,
		pageNotFoundCallback: RequestCallback<void | Document, LooseObject | undefined>
	) {
		this.timeStart = Date.now();

		this.uri = request.url || '/';

		this.app = app;

		this.request = request;
		this.response = response;

		this.handler = handler;

		this.body = undefined as Body;

		this.pageNotFoundCallback = pageNotFoundCallback;

        this.exec();
	}

    private async exec(): Promise<void> {
		this.initGetArgs();
		this.parseCookies();

		if (this.handler) {
			try {
				await this.parseBody();
			} catch(e) {
				this.error(e);
			}
		}

        await this.handle();
    }

	public async respondWith(data: any): Promise<void> {
		if (typeof data === 'string' || Buffer.isBuffer(data)) {
			this.sendResponse(data, 'text/plain; charset=utf-8');
		} else if (typeof data === 'number') {
			this.sendResponse(data.toString(), 'text/plain; charset=utf-8');
		} else if (data instanceof Document) {
			this.sendResponse(await data.toString(), 'text/html; charset=utf-8');
		} else if (data === undefined || data === null) {
			this.sendResponse('', 'text/plain; charset=utf-8');
		} else {
			this.sendResponse(JSON.stringify(data, null, 4), 'application/json; charset=utf-8');
		}
	}

    private sendResponse(
        buffer: string | Buffer,
        contentType: string
    ): void {
        // content type might be text/javascript; charset=utf-8
        // we only care about mime type when deciding whether to gzip
        const mimeType = contentType.split(';')[0];
        
        const gzipResponse =    this.app.config.gzip.enabled &&
                                this.app.config.gzip.types.includes(mimeType) &&
                                this.request.headers['accept-encoding']?.includes('gzip') &&
                                buffer.length >= this.app.config.gzip.minSize;

        if (!this.response.hasHeader('Content-Type')) {
            // only set given content type header if Content-Type header is not already set
            this.response.setHeader('Content-Type', contentType);
        }

        // convert to UTF8 Buffer to get correct length
        if (typeof buffer === 'string') {
            buffer = Buffer.from(buffer, 'utf-8');
        }

        if (gzipResponse) {
            // gzip response
            this.response.setHeader('Content-Encoding', 'gzip');

            const compressed = zlib.gzipSync(buffer, {
                level: this.app.config.gzip.compressionLevel
            });

            this.response.setHeader('Content-Length', compressed.length);
            this.response.write(compressed);
        } else {
            // no gzip
            this.response.setHeader('Content-Length', buffer.length);
            this.response.write(buffer);
        }
    }

	public async createDocument(title: string, component: string, data?: LooseObject): Promise<Document> {
		const doc = new Document(this.app, title, this);
		await doc.loadComponent(component, data);
		return doc;
	}

    // creates a Document using provided layout
    public async layoutDocument(
        layout: Layout,
        title: string,
        component: string,
        data?: LooseObject,
        attributes?: Record<string, string>
    ): Promise<Document> {
        return await layout.document(this, title, component, data, attributes);
    }

	public async show404(): Promise<void> {
		// emit pageNotFound before running the callback
		// to allow user to modify RequestContext.data if needed
		this.app.emit('pageNotFound', this);

		this.response.statusCode = 404;

		// run pageNotFoundCallback callback
		const res = await this.pageNotFoundCallback.apply(this.app, [this]);

		
		// if pageNotFoundCallback returned a Document, send it as a response
		if (res instanceof Document) {
			await this.respondWith(res);
		}
	}

	// extract any GET args from the URL-provided query string eg. /page?key=val
	// once extracted, remove the query string part of the URL
	private initGetArgs(): void {
		if (this.uri.indexOf('?') > -1) {
			const uriParts = this.uri.split('?');
			this.uri = uriParts[0];
			this.getArgs = queryStringDecode(uriParts[1]);
		}
	}

	private parseCookies() {
		this.cookies = this.app.cookies.parse(this.request);
	}

    // send the headers to redirect the client, 302 redirect by default
    // should be called before any output (before any res.write)
    public redirect(to: string, statusCode: number = 302): void {
        this.response.setHeader('Location', to);
        this.response.writeHead(statusCode);
    }

   	// returns the raw request data (eg. POST'ed data)
	private dataRaw(request: IncomingMessage): Promise<Buffer> {
		const chunks: Array<Buffer> = [];

		return new Promise((resolve, reject) => {
			request.on('data', (chunk) => {
				chunks.push(chunk);
			});
	
			request.on('close', () => {
				// calculate the total size of all chunks
				const size = chunks.reduce((prev, curr) => {
					return prev + curr.length;
				}, 0);

				// combine the chunks to form final data
				const data = Buffer.concat(chunks, size);
				
				resolve(data);
			});

			request.on('error', (e) => {
				reject(e);
			});
		});
	}

    // parse raw request body
    // if there is a parser for received Content-Type
    // then ctx.body is populated with data: URIArgs
    private async parseBody(): Promise<void> {
        if (this.request.headers['content-type']) {

            this.bodyRaw = await this.dataRaw(this.request);

            if (this.request.headers['content-type'].indexOf('urlencoded') > -1) {
                // application/x-www-form-urlencoded
                const bodyRaw = this.bodyRaw.toString('utf-8');
                try {
                    this.body = queryStringDecode(bodyRaw) as Body;
                } catch (e) {
                    console.error(`Error parsing urlencoded request body for request to ${this.request.url}, (${e.message}).
                    Raw data:
                        ${bodyRaw}

                    `);
                }
            } else if (this.request.headers['content-type'].indexOf('multipart/form-data') > -1) {
                // multipart/form-data
                let boundary: RegExpExecArray|null|string = /^multipart\/form-data; boundary=(.+)$/.exec(this.request.headers['content-type']);
                if (boundary) {
                    boundary = `--${boundary[1]}`;
                    try {
                        this.body = this.parseBodyMultipart(this.bodyRaw.toString('utf-8'), boundary) as Body;
                    } catch (e) {
                        console.error(`Error parsing multipart request body for request to ${this.request.url}, (${e.message}).
                        Raw data:
                            ${this.bodyRaw.toString('utf-8')}
                            
                        `);
                    }

                    try {
                        this.files = this.multipartBodyFiles(this.bodyRaw.toString('binary'), boundary);
                    } catch (e) {
                        this.error(`Error parsing multipart request body files: (${e.message}).
                        Raw data:
                            ${this.bodyRaw.toString('utf-8')}
                            
                        `);
                    }
                }
            } else if (this.request.headers['content-type'].indexOf('application/json') > -1) {
                // application/json
                try {
                    this.body = JSON.parse(this.bodyRaw.toString());
                } catch (e) {
                    // failed to parse the body
                    this.body = undefined as Body;
                }
            }
        }
    }


    // process raw multipart/form-data body into an object
    // boundary has to be provided as second argument
    private parseBodyMultipart(bodyRaw: string, boundary: string): PostedDataDecoded {
        const pairsRaw = bodyRaw.split(boundary);
        const pairs = pairsRaw.map((pair) => {
            const parts = pair.split(/\r?\n\r?\n/, 2).filter((part) => {return part.length > 0});
            if (parts.length > 0) {
                const header = parts[0];
                const data = typeof parts[1] === 'string' ? parts[1].trim() : '';
                const headerParts = /Content-Disposition: form-data; name="([^\r\n"]+)"/m.exec(header);
                if (headerParts) {
                    return {
                        key: headerParts[1],
                        value: data
                    }
                }
            }
            return null;
        });
        
        // convert data to query string
        const urlEncoded = pairs.reduce((prev, curr) => {
            if (curr !== null) {
                prev.push(`${curr.key}=${encodeURIComponent(curr.value.replaceAll('&', '%26'))}`);
            }
            return prev;
        }, [] as Array<string>).join('&');
    
        return queryStringDecode(urlEncoded);
    }

    private multipartBodyFiles(bodyRaw: string, boundary: string): Record<string, RequestBodyFile> {
        let files: Record<string, RequestBodyFile> = {}
        const pairsRaw = bodyRaw.split(boundary);
        pairsRaw.map((pair) => {
            const parts = /Content-Disposition: form-data; name="(.+?)"; filename="(.+?)"\r\nContent-Type: (.*)\r\n\r\n([\s\S]+)$/m.exec(pair);
            if (parts) {
                const file: RequestBodyFile = {
                    data: Buffer.from(parts[4].substring(0, parts[4].length - 2).trim(), 'binary'),
                    fileName: parts[2],
                    type: parts[3]
                }
                // we can't just set the file as files[parts[1]] = file
                // that would work if parts[1] is a simple key without "[.*]" in it
                // but in reality key will often be an object or an array
                // so we need to recursively create the object and fill it with file
                // then merge that result with resulting files object
                files = mergeDeep(files, queryStringDecodedSetValue(parts[1], file));
            }
            return null;
        })
        return files;
    }


    // extract variables from the given URI, using provided match which is defined by current request handler
    // hence this only gets executed for requests that have a registered handler
    private extractURIArguments(uri: string, match: Array<URISegmentPattern> | RegExp): URIArguments {
        if (match instanceof RegExp) {
            const matches = match.exec(uri);
            if (matches) {
                return {
                    matches
                };
            } else {
                return {};
            }
        }

        const uriArgs:URIArguments = {};

        const segments = uri.split('/');

        match.forEach((segmentPattern, i) => {
            if (segmentPattern.name) {
                uriArgs[segmentPattern.name] = segmentPattern.type === 'number' ? parseInt(segments[i]) : segments[i];
            }
        });

        return uriArgs;
    }

    private async handle(): Promise<void> {
        if (this.handler !== null) {
            // handler exists
            if (!this.handler.staticAsset) {
                // run beforeRequestHandler callbacks
                const results = await this.app.emit('beforeRequestHandler', this);
    
                // if any of the beforeRequestHandler callbacks returned false, end the request here
                // this provides a way for the developer to prevent the request handler from being executed
                // which is useful in some cases, for example:
                // beforeRequestHandler checks if user is logged in, if not redirects to login
                // and returns false to prevent unauthorized access to user-only page
                if (results.includes(false)) {
                    this.response.end();
                    return;
                }

                // extract URI arguments, if pattern included capture groups, those will be included
                // for example pattern /users/(userId:num) -> { userId: number }
                const URIArgs = this.extractURIArguments(this.uri, this.handler.match);
                this.args = URIArgs;
            }

            
            // run the request handler callback
            try {
                const response = await this.handler.callback.apply(this.handler.scope, [this]);
                if (!this.response.headersSent) {
                    // if the response was not sent from the request handler
                    // respond with whatever the handler has returned
                    await this.respondWith(response);
                }
            } catch(e) {
                console.log('Error executing request handler ', e, this.handler.callback.toString());
            }

            if (!this.handler.staticAsset) {
                await this.app.emit('afterRequestHandler', this);
            }
        } else {
            // handler not found, check if a static asset is requested
            let staticAsset = false;

            if (this.app.config.url.isAsset(this.request.url || '')) {
                // static asset
                // unless accessing /assets/ts/* go directory up to get out of build
                const basePath = this.request.url?.startsWith('/assets/ts/') ? './' : '../';
                const assetPath = path.resolve(basePath + this.request.url);
                if (existsSync(assetPath)) {
                    await this.app.emit('beforeAssetAccess', this);
                    const extension = (this.request.url || '').split('.').pop();
                    let contentType = 'application/javascript';
                    if (extension) {
                        const typeByExtension = this.app.contentType(extension);
                        if (typeByExtension) {
                            contentType = typeByExtension;
                        }
                    }
                    this.sendResponse(readFileSync(assetPath), contentType);
                    staticAsset = true;
                    await this.app.emit('afterAssetAccess', this);
                }
            }

            if (! staticAsset) {
                // no request handler found nor a static asset - 404
                await this.show404();
            }

        }

        // end the response
        this.response.end();
    }

	// true if x-requested-with header is received and it equals 'xmlhttprequest'
	public isAjax(): boolean {
		return this.request.headers['x-requested-with'] == 'xmlhttprequest';
	}

	private error(e: Error | string): void {
		const message = typeof e === 'string' ? e : e.message;
		console.error(`Error in request to ${this.uri}: ${message}`);
	}
}