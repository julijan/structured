import { IncomingHttpHeaders } from 'http';
import { RequestMethod } from '../Types.js';


export class NetRequest {
    xhr: XMLHttpRequest = new XMLHttpRequest();
    method: RequestMethod;
    url: string;
    headers: IncomingHttpHeaders;
    responseType: XMLHttpRequestResponseType;
    body: any;
    requestSent: boolean = false;

    constructor(method: RequestMethod, url: string, headers: IncomingHttpHeaders = {}, responseType: XMLHttpRequestResponseType = 'text', body?: any) {
        this.method = method;
        this.url = url;
        this.headers = headers;
        this.responseType = responseType;
        this.body = body;

        this.xhr.open(this.method, this.url);
        this.xhr.responseType = this.responseType;


        // set the X-Requested-With: xmlhttprequest header if not set by user
        if (!('x-requested-with' in headers)) {
            headers['x-requested-with'] = 'xmlhttprequest';
        }

        // set request headers
        for (const header in headers) {
            const headerValue = headers[header];
            if (typeof headerValue === 'string') {
                this.xhr.setRequestHeader(header, headerValue);
            } else {
                console.warn('Only string header values are supported');
            }
        }
    }

    public async send(body?: any): Promise<string> {
        if (this.requestSent) { return ''; }
        this.requestSent = true;
        if (typeof body !== 'undefined') {
            this.body = body;
        }

        return new Promise((resolve, reject) => {
            // listen for state change
            this.xhr.onreadystatechange = () => {
                if (this.xhr.readyState == 4) {
                    // got the response
                    resolve(this.xhr.responseText);
                }
            };
            // reject on error
            this.xhr.onerror = (err) => {
                reject(err);
            };

            this.xhr.send(body);
        });
    }
}
