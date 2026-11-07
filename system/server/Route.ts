import { Request } from "./Request.js";
import { LooseObject } from "../types/general.types.js";
import { RequestMethod, URIPattern } from "../types/request.types.js";
import { RequestContext } from "./RequestContext.js";

// Request.route returns instance of Route
// the only public method is handle, allowing the user to attach a request handler
export class Route<Segments extends LooseObject> {
    private request: Request;
    private requestMethod: RequestMethod | Array<RequestMethod>;
    private pattern: URIPattern;
	private attached: boolean = false;

    constructor(
        request: Request,
        requestMethod: RequestMethod | Array<RequestMethod>,
        uriPattern: URIPattern
    ) {
        this.request = request;
        this.requestMethod = requestMethod;
        this.pattern = uriPattern;
    }

    public handle<Response, Body extends LooseObject = LooseObject>(
        callback: (ctx: RequestContext<Body, Segments>) => Promise<Response>
    ): void {
		if (this.attached) {
			// prevent attaching multiple handlers for the same route
			console.warn(`Request handler for this route already attached`);
			return;
		}
        this.request.on(this.requestMethod, this.pattern, callback);
		this.attached = true;
    }
}