import { IncomingHttpHeaders } from 'http';
import { LooseObject, RequestMethod } from '../Types.js';
import { NetRequest } from './NetRequest.js';


export class Net {

    // Make a HTTP request
    public async request(method: RequestMethod, url: string, headers: IncomingHttpHeaders = {}, body?: any, responseType: XMLHttpRequestResponseType = 'text'): Promise<string> {
        const request = new NetRequest(method, url, headers, responseType);
        return request.send(body);
    }

    public async get(url: string, headers: IncomingHttpHeaders = {}): Promise<string> {
        return this.request('GET', url, headers);
    }

    public async delete(url: string, headers: IncomingHttpHeaders = {}): Promise<string> {
        return this.request('DELETE', url, headers);
    }

    public async post(url: string, data: any, headers: IncomingHttpHeaders = {}): Promise<string> {
        if (typeof data === 'object' && !headers['content-type']) {
            // if data is object and no content/type header is specified default to application/json
            headers['content-type'] = 'application/json';
            // convert data to JSON
            data = JSON.stringify(data);
        }
        return await this.request('POST', url, headers, data);
    }

    public async put(url: string, data: any, headers: IncomingHttpHeaders = {}): Promise<string> {
        if (typeof data === 'object' && !headers['content-type']) {
            // if data is object and no content/type header is specified default to application/json
            headers['content-type'] = 'application/json';
            // convert data to JSON
            data = JSON.stringify(data);
        }
        return this.request('PUT', url, headers, data);
    }

    public async getJSON<T>(url: string, headers?: IncomingHttpHeaders): Promise<T> {
        return JSON.parse(await this.get(url, headers));
    }

    public async postJSON<T>(url: string, data: LooseObject, headers?: IncomingHttpHeaders): Promise<T> {
        return JSON.parse(await this.post(url, data, headers));
    }

    public async deleteJSON<T>(url: string, headers?: IncomingHttpHeaders) {
        return JSON.parse(await this.delete(url, headers));
    }

    public async putJSON<T>(url: string, data: LooseObject, headers?: IncomingHttpHeaders): Promise<T> {
        return JSON.parse(await this.put(url, data, headers));
    }

}
