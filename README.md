# Structured
Production-tested Node.js framework for creating performant **server-side rendered** web apps and APIs, with a sane amount of client side abstraction.

Framework allows the developer to develop self-contained components which are rendered server side and allows rendering a subset of components on demand. In addition to that, it includes versatile routing (including decoding of request body), session and cookie handling, easy environment variable access, form validation utilities and a templating engine (Handlebars).

It works with Node.js and Deno runtimes. Other runtimes are not tested.

- [Why Structured](#why-structured)
- [Audience](#audience)
- [Getting started](#getting-started)
- [Key concepts](#key-concepts)
- [Good to know](#good-to-know)


### Key concepts:
* [Application](#application)
* [Route](#route)
* [Document](#document)
* [Component](#component)

## Getting started

_Following getting started instructions are relevant for Node.js runtime, if you are using Deno skip to [runtimes](#runtimes) section._

### Initialize a Node.js project
```
cd /path/to/project
npm init -y
npm install @types/node
```

*If you have TypeScript installed globally then you can skip the following*\
`npm install --save-dev typescript`

### Install Structured
`npm install structured-fw`

### Create boilerplate
`npx structured init`

### Create a test route
Create a file `/app/routes/Test.ts`:
```
import { Application } from 'structured-fw/Application';
export default function(app: Application) {
    app.request.on('GET', '/test', async()=> {
        return 'Hello, World!';
    });
}
```

### Compile
`tsc`\
This will create a directory `build` (or whatever you have in tsconfig.json as compilerOptions.outputDir)

### Run
```
cd build
node index.js
```

Of course, you can use pm2 or other process managers to run it, with pm2:
```
cd build
pm2 start index.js --name="[appName]"
```

If you followed the above steps, you should be able to access `http://localhost:9191/test` in your browser and see the output `Hello, World!`.

# Key concepts

## Application
Application instance is the base of any Structured application. You will usually create an instance of Application in index.ts (or whatever you decide to be the entry point file name). Application starts a http server, creates instances of all classes that are required for the functioning of your application and allows handling of various events that will occur when your app is running.\
Application constructor requires one argument of type `StructuredConfig`:
```
type StructuredConfig = {
    readonly envPrefix?: string,
    readonly autoInit: boolean,
    url: {
        removeTrailingSlash: boolean,
        componentRender: false | string,
        isAsset: (url: string) => boolean
    },
    routes: {
        readonly path: string
    },
    components: {
        readonly path: string,
        readonly componentNameAttribute: string
    },
    session: {
        readonly cookieName: string,
        readonly keyLength: number,
        readonly durationSeconds: number,
        readonly garbageCollectIntervalSeconds: number,
        readonly garbageCollectAfterSeconds: number
    },
    http: {
        host?: string,
        port: number,
        linkHeaderRel: 'preload' | 'preconnect'
    },
    readonly runtime: 'Node.js' | 'Deno'
}
```

If you created the boilerplate using `npx structured init` then a sample `Config.ts` has been created in the project root. You can read the comments there if you need clarification on what each config option affects.

The most basic entry point may look something like this:
```
import { Application } from "structured-fw/Application";
import { config } from "./Config.js";

new Application(config);
```

### Properties
- `cookies` - Instance of Cookies, allows you to set a cookie
- [`session`](#session) - Instance of Session, utilities to manage sessions and data
- `request` - Instance of Request, you will use this to add routes, but usually not directly by accessing Application.request, more on that in [routes](#route) section
- `handlebars` - Instance of Handlebars (wrapper around Handlebars templating engine)
- `components` - Instance of Components, this is the components registry, you should never need to use this directly

### Methods
- `init(): Promise<void>` - initializes application, you only need to run this if you set `autoInit = false` in config, otherwise this will be ran when you create the Application instance
- `on(evt: ApplicationEvents, callback: RequestCallback|((payload?: any) => void))` - allows you to add event listeners for specific `ApplicationEvents`:
    - `serverStarted` - executed once the built-in http server is started and running. Callback receives Server (exported from node:http) instance as the first argument
    - `beforeRequestHandler` - runs before any request handler (route) is executed. Callback receives `RequestContext` as the first argument. Useful for example to set `RequestContext.data: RequestContextData` (user defined data, to make it available to routes and components)
    - `afterRequestHandler` - runs after any request handler (route) is executed. Callback receives `RequestContext` as the first argument
    - `afterRoutes` - runs after all routes are loaded from `StructuredConfig.routes.path`. Callback receives no arguments
    - `beforeComponentsLoad` - runs before components are loaded from `StructuredConfig.components.path`. Callback receives no arguments
    - `afterComponentsLoaded` - runs after all components are loaded from `StructuredConfig.components.path`. Callback receives instance of Components as the first argument
    - `documentCreated` - runs whenever an instance of a [Document](#document) is created. Callback receives the Document instance as the first argument. You will often use this, for example if you want to include a CSS file to all pages `Document.head.addCSS(...)`
    - `beforeAssetAccess` - runs when assets are being accessed, before response is sent. Callback receives `RequestContext` as the first argument
    - `afterAssetAccess` - runs when assets are being accessed, after response is sent. Callback receives `RequestContext` as the first argument
    - `pageNotFound` - runs when a request is received for which there is no registered request handler (route), and the requested URL is not an asset. Callback receives `RequestContext` as the first argument
    - **Callback to any of the `ApplicationEvents` is expected to be an async function**
- `importEnv<T extends LooseObject>(smartPrimitives: boolean = true): T` - import ENV variables that start with `StructuredConfig.envPrefix`_ (if envPrefix is omitted from config, all ENV variables are returned). It is a generic method so that you can specify the expected return type. If `smartPrimitives = true` importEnv will convert the ENV values to type it feels is appropriate:
    - numeric values -> `number`
    - "true"|"false" -> `boolean`
    - "null" -> `null`
    - "undefined" -> `undefined`
- `exportContextFields(...fields: Array<keyof RequestContextData>): void` - allows you to export any fields from `RequestContextData` to all components (even if they don't have server side code)

What your entry point may look like in a real-world application:
```
import { Application } from "structured-fw/Application";
import { config } from './Config.js';
import { userModel } from './app/models/User.js';

const app = new Application(config);

const env = app.importEnv<{ COOKIE_AUTOLOGIN: string }>();

app.on('documentCreated', (doc: Document) => {
    doc.head.setFavicon({
        image: '/assets/img/favicon.png',
        type: 'image/png'
    });
    doc.head.addCSS('/assets/css/dist.css', 0);
});

app.on('beforeRequestHandler', async (ctx: RequestContext) => {

    // set ctx.data.user from session
    ctx.data.user = app.session.getValue<User>(ctx.sessionId, 'user');

    if (! ctx.data.user) {
        // check if user has an autologinKey cookie set
        const autologinCookie = ctx.cookies[env.COOKIE_AUTOLOGIN];
        if (autologinCookie) {
            const user = await userModel.getByAutologinKey(autologinCookie);
            if (user) {
                ctx.data.user = user;
            }
        }
    }
});

// load handlebars helpers (which will become available in all components)
app.handlebars.loadHelpers(path.resolve('./app/Helpers.js'));

// make user available to all components
app.exportContextFields('user');

```

### Session
Session allows you to store temporary data for the users of your web application. You don't need to create an instance of Session, you will always use the instance `Application.session`.

Session data is tied to a visitor via sessionId, which is always available on `RequestContext`, which means you can interact with session data from routes and server side code of your components.

**Configuration**\
`StructuredConfig`.`session`:
```
{
    // cookie name for the session cookie
    readonly cookieName: string,

    // cookie stores the session key (a random string), keyLength determines it's length (longer key = more secure)
    readonly keyLength: number,

    // sessions expire after durationSeconds of no activity
    readonly durationSeconds: number,

    // session garbage collector runs every garbageCollectIntervalSeconds
    // removing expired sessions from the memory
    readonly garbageCollectIntervalSeconds: number
}
```

**Methods**
- `setValue(sessionId: string, key: string, value: any): void` - set a session value for given sessionId
- `getValue<T>(sessionId: string, key: string): T | null` - return a value for given `key` from session, if `key` is not set, returns `null`. It is a generic method so you can specify the expected return type
- `removeValue(sessionId: string, key: string): void` - remove value for given `key`
- `getClear<T>(sessionId: string, key: string): T | null` - return and clear value for given `key`
- `clear(sessionId: string): void` - clear all data for given `sessionId`
- `extract(sessionId: string, keys: Array<string|{ [keyInSession: string] : string }>): LooseObject` - extract given keys from session and return them as an object. Key in `keys` can be a string in which case the key will remain the same in returned object or it can be an object { keyInSession : keyInReturnedData } in which case key in returned data will be keyInReturnedData


## Route
Routes are the first thing that gets executed when your application receives a request. They are a mean for the developer to dictate what code gets executed depending on the URL. In addition to that, they allow capturing parts of the URL for use within the route.


You can add routes from your entry point using `app.request.on(RequestMethod, URLPattern, requestHandler)`, but you will never want to do that unless your entire application has a very few routes, in which case it would be acceptable.

**Simple route:**
```
app.request.on('GET', '/hello/world', async () => {
    return 'Hello, world!';
});
```


In a real life situation, you will likely have quite a few routes that you want to handle, and it usually makes sense to group them in multiple files, for example Auth.ts, Users.ts, Products.ts, etc...
When Application instance is created and initialized, it will load all routes from `conf.routes.path`.

All route files need to export a function that will receive the Application instance as the first argument:
```
import { Application } from "structured-fw/Application";

export default function(app: Application) {
    // all routes that belong to this file come here
    app.request.on(...)
}
```

Route file name has no effect on how the route (request handler) behaves, the only purpose of splitting your routes in separate files is making your code more maintainable.

### RequestContext
All request handlers receive a `RequestContext` as the first argument.
```
type RequestContext<Body extends LooseObject | undefined = LooseObject> = {
    request: IncomingMessage,
    response: ServerResponse,
    args: URIArguments,
    handler: null|RequestHandler,

    cookies: Record<string, string>,

    // POSTed data, parsed to object
    body?: LooseObject,

    bodyRaw?: Buffer,

    // files extracted from request body
    files?: Record<string, RequestBodyRecordValue>,

    // user defined data
    data: RequestContextData,

    // if session is started and user has visited any page
    sessionId?: string,

    // true if x-requested-with header is received and it equals 'xmlhttprequest'
    isAjax: boolean,

    // time when request was received (unix timestamp in milliseconds)
    timeStart: number,

    // URL GET arguments
    getArgs: PostedDataDecoded,

    // send given data as a response
    respondWith: (data: any) => void,

    // redirect to given url, with given statusCode
    redirect: (to: string, statusCode?: number) => void,

    // show a 404 page
    show404: () => Promise<void>
}
```

**Capture URL segment:**\
Any URL segments in parenthesis will become available in ctx.args. For example:
```
app.request.on('GET', '/greet/(name)', async (ctx) => {
    return `Hello, ${ctx.args.name}!`;
});
```
You can capture any number of URL segments in this way.

**Capture group modifiers:**\
Capture group in URL pattern is (name) in above example. It makes data available within your route. Name will capture any string. Sometimes we know we expect a number in our URLs, in which case it is useful to use the modifier :num (which is the only modifier available), for example:
```
app.request.on('GET', '/greet/(userId:num)', async (ctx) => {
    const userId = ctx.args.userId as number;
    // fetch user from DB
    const user = await userModel.get(userId);
    return `Hello, ${user.name}!`;
});
```
It is safe to cast `ctx.args.userId` as `number` in above example because the route would not get executed if the second segment of the URL is not a numeric value, and in case :num modifier is used, URL-provided value is parsed to a number and you don't need to parseInt manually.


**Doing more with less code**\
You can have the same route be executed for multiple different request methods or URLs. Both request method (first argument) and URL pattern (second argument) can be an array.
```
app.request.on(['GET', 'POST'], ['/greet/(name)', '/hello/(name)'], async (ctx) => {
    return `Hello, ${ctx.args.name}!`;
});
```
Above is equivalent of registering 4 request handlers one-by-one:\
GET '/greet/(name)'\
POST '/greet/(name)'\
GET '/hello/(name)'\
POST '/hello/(name)'

**RegExp as URLPatter**\
In some edge cases you may need more control of when a route is executed, in which case you can use a regular expression as URLPattern. If you use a RegExp, ctx.args will be `RegExpExecArray` so you can still capture data from the URL. This is very rarely needed because Structured router is versatile and covers almost all use cases.

> [!TIP]
> Since version 0.8.1 `Request`.`on` is a generic, accepting 0-2 generic arguments. First argument defines the request handler return type (response type) and defaults to any, second argument allows you to specify the expected (parsed) request body type, defaults to LooseObject.
> ```
> app.request.on<Document, {
>   email: string,
>   password: string,
>   age: number
>}>('POST', '/users/create', async (ctx) => {
>    ctx.body.email // string
>    ctx.body.age // number
>    const doc = new Document(app, 'User', ctx);
>    return doc; // error if we return anything but Document
> });
> ```

## Document
Document does not differ much from a component, in fact, it extends Component. It has a more user-friendly API than Component. Each Document represents a web page. It has a head and body. Structured intentionally does not differentiate between a page and a Component - page is just a component that loads many other components in a desired layout. DocumentHead (each document has one at Document.head) allows adding content to `<head>` section of the output HTML page.

Creating a document:
`const doc = new Document(app, 'HelloWorld page', ctx);`

Send document as a response:
```
app.request.on('GET', '/home', async (ctx) => {
    const doc = new Document(app, 'Home', ctx);
    await doc.loadComponent('Home');
    return doc;
});
```

> [!TIP]
> Since version 0.8.4 Document extends EventEmitter, and "componentCreated" event is emitted whenever a component instance is created within the Document.\
> This makes the following possible:
> ```
> app.on('documentCreated', (doc) => {
>   doc.on('componentCreated', (component) => {
>       // do something with the document or the component
>   })    
> })
> ```

## Component
A component is comprised of [1-3 files](#component-parts). It always must include one HTML file, while server side and client side files are optional.
* HTML file probably requires no explanation
* server side file, code that runs on the server and makes data available to HTML and client side code
* client side file, code that runs on the client (in the browser)

> [!TIP]
> You should never need to instantiate a Component on your own. You will always load a Component representing your page into a document (using `Document.loadComponent(componentName: string)`), which will know what to do from there.

Example component files:
- `/app/views/`
    - `ComponentName.html`
    - `ComponentName.ts`
    - `ComponentName.client.ts`

It is recommended, but not necessary, that you contain each component in it's own directory:
- `/app/views/ComponentName/`
    - `ComponentName.html`
    - `ComponentName.ts`
    - `ComponentName.client.ts`

\
**Component rules:**
- **Component names must be unique**
- Components HTML file can have a `.hbs` extension (which allows for better Handlebars syntax highlighting)
- Components can reside at any depth in the file structure

### Component parts
- [Component HTML](#component-html) (_ComponentName.html_)
- [Component server-side code](#component-server-side-code) (_ComponentName.ts_)
- [Component client-side code](#component-client-side-code) (_ComponentName.client.ts_)

### Component HTML
Let's create a HelloWorld Component `/app/views/HelloWorld/HelloWorld.html`:\
`Hello, World!`

Let's load this Component into a Document and send it as a response `/app/routes/HelloWorld.ts`:
```
export default function(app: Application) {
    app.request.on('GET', '/hello/world', async (ctx) => {
        const doc = new Document(app, 'Hello, World! From a Component', ctx);
        await doc.loadComponent('HelloWorld');
        return doc;
    });

    // other routes here...
}
```

You can now run the app and if you open /hello/world in the browser you will see:\
`Hello, World!` - which came from your HelloWorld component.

> [!TIP]
> It is recommended to use .hbs (Handlebars) extension as you will get better syntax highlighting in most IDEs. Other than syntax highlighting there is no difference between using html or hbs extension.

That was the simplest possible example, let's make it more interesting by adding some server-side code.

### Component server-side code
Create a new file `/app/views/HelloWorld/HelloWorld.ts` (server side component code):
```
import { ComponentScaffold } from 'structured-fw/Types';
export default class HelloWorld implements ComponentScaffold {
    async getData(): Promise<{
        luckyNumber: number
    }> {
        return {
            luckyNumber: this.num()
        }
    }

    num(): number {
        return Math.floor(Math.random() * 100);
    }
}
```

Update `HelloWorld.html`:
```
Hello, World!<br>
Your lucky number is {{luckyNumber}}
```

Now when you access /hello/world you will see:
```
Hello, World!
Your lucky number is [a number from 0-100]
```

This demonstrates the use of a *server side component code* to make data available to HTML.
We just generated a random number, but the data could be anything and will more often come from a database, session, or be provided by the parent component.

> [!IMPORTANT]
> Server side `getData` will receive the following arguments:
> - `data: LooseObject` any data passed in (either by attributes, ClientComponent.add or ClientComponent.redraw)
> - `ctx: RequestContext` - current `RequestContext`, you will often use this to access for example ctx.data (`RequestContextData`) or ctx.sessionId to interact with session
> - `app: Application` - your Application instance. You can use it to, for example, access the session in combination with ctx.sessionId

Let's make it even more interesting by adding some client side code to it.

### Component client-side code
Create `/app/views/HelloWorld/HelloWorld.client.ts`:
```
import { InitializerFunction } from 'structured-fw/Types';
export const init: InitializerFunction = async function() {
    const generateNew = this.ref<HTMLButtonElement>('newNumber');

    this.bind(generateNew, 'click', () => {
        this.redraw();
    });
}
```

Update `/app/views/HelloWorld/HelloWorld.html`:
```
Hello, World!<br>
Your lucky number is {{luckyNumber}}<br>
<button ref="newNumber">No it's not!</button>
```

Now when you open /hello/world, the page will contain a button, when you click it, component will be redrawn and you will likely end up with a new number (unless the same random number ends up being generated, in which case you should just trust it to be your lucky number).

We've now covered all parts of a component, albeit in their simplest form. Another thing worth mentioning is that you can load other components within your components, for example:
```
Hello, World!<br>
Your lucky number is {{luckyNumber}}<br>
<button ref="newNumber">No it's not!</button>

<AnotherComponent></AnotherComponent>
```

This would load a Component with name `AnotherComponent` in your `HelloWorld` Component.

Passing data to child Component. Let's say we wanted to pass the `luckyNumber` to `AnotherComponent`:
```
Hello, World!<br>
Your lucky number is {{luckyNumber}}<br>
<button ref="newNumber">No it's not!</button>

<AnotherComponent {{{attr 'number' luckyNumber}}}></AnotherComponent>
```

That's it. `AnotherComponent` will receive the `luckyNumber` as a number, you can pass any type of data, string, number, boolean, object, array... it will be received by the child as the same type of data. However, *keep in mind the data gets serialized and de-serialized in the process, so if you pass an object to a child, it won't be a reference to the original object, rather a copy of it*.
\
Let's see how we can use the passed data within `AnotherComponent`, create `/app/views/AnotherComponent/AnotherComponent.html`:
```
Parent says your lucky number is {{number}}.
```

That's it. Since `AnotherComponent` has no server side code, all data passed to it is exported to HTML, hence the `number` you passed from `HelloWorld` will be readily available for use. If AnotherComponent had a server side part, the process is a bit different, it will receive it as part of the `data`, but can choose whether to make it available to the HTML, or just make use of it and return other stuff. Let's see how that works.
Create `/app/views/AnotherComponent/AnotherComponent.ts`:
```
import { ComponentScaffold } from 'structured-fw/Types';
export default class AnotherComponent implements ComponentScaffold {
    async getData(data: { number: number }): Promise<{
        parentSuggests: number,
        betterNumber: number
    }> {
        return {
            parentSuggests: data.number,
            betterNumber: data.number + 5
        }
    }
}
```

Update `/app/views/AnotherComponent/AnotherComponent.html`:\
`Parent says your lucky number is {{parentSuggests}}, but actually it is {{betterNumber}}.`

What we did is, we accepted the number provided by parent component, and returned
```
{
    parentSuggests: number,
    betterNumber: number
}
```
which is now available in `AnotherComponent` HTML, we assigned the received number to `parentSuggests`, while `betterNumber` is `parentSuggests + 5`, we now have these 2 available and ready to use in our HTML template.

What about client side? **By default, data returned by server side code is not available in client side code** for obvious reasons, let's assume your server side code returns sensitive data such as user's password, you would not like that exposed on the client side, hence exporting data needs to be explicitly requested in the server side code. There are two ways to achieve this, setting `exportData = true` (exports all data), or `exportFields: Array<string> = [...keysToExport]` (export only given fields).

> [!NOTE]
> Whenever a component with server-side code is rendered, `getData` is automatically called and anything it returns is available in HTML. You can export all returned data to client-side code by setting `exportData = true` or you can export some of the fields by setting `exportFields = ["field1", "field2", ...]` as a direct property of the class. To access the exported data from client-side use `ClientComponent`.`getData(key: string)` which will be `this.getData(key:string)` within client side code.

Let's create a client side code for `AnotherComponent` and export the `betterNumber` to it, create `/app/views/AnotherComponent/AnotherComponent.client.ts`:
```
import { InitializerFunction } from 'structured-fw/Types';
export const init: InitializerFunction = async function() {
    const betterNumber = this.getData<number>('betterNumber');

    alert(`Did you know that your actual lucky number is ${betterNumber}?`);
}
```

And let's update `AnotherComponent.ts` to export `betterNumber`:
```
import { ComponentScaffold } from 'structured-fw/Types';
export default class AnotherComponent implements ComponentScaffold {
    exportFields = ['betterNumber'];
    async getData(data: { number: number }): Promise<{
        parentSuggests: number,
        betterNumber: number
    }> {
        return {
            parentSuggests: data.number,
            betterNumber: data.number + 5
        }
    }
}
```

The only change is we added `exportFields = ['betterNumber'];`, that's all there is to it, better number is now available to component's client side code, again, any type of data can be exported and type of data is preserved in the process.

**What about passing data from children to parent?**\
This concept is wrong to start with, if we want a component to be independent, it should not assume it's parent to exist, or behave in any specific way. That being said, components can access each other, and communicate, even from child to parent (only in client side code).

Let's say we wanted to access the `parent` Component from `AnotherComponent`:
```
import { InitializerFunction } from 'structured-fw/Types';
export const init: InitializerFunction = async function() {
    const betterNumber = this.getData<number>('betterNumber');

    alert(`Don't listen to what ${this.parent.name} said! Your actual lucky number is ${betterNumber}?`);
}
```
Here we accessed the `parent` and obtained it's `name`.

*"But we did not send any data to the parent here"* - correct, we did not, and we won't, instead we can inform them we have some data available, or that an event they might be interested in has occurred, and if they care, so be it:
```
import { InitializerFunction } from 'structured-fw/Types';
export const init: InitializerFunction = async function() {
    const betterNumber = this.getData<number>('betterNumber');

    this.emit('truth', `You lied, their lucky number is actually ${betterNumber}`);
}
```

We emitted an `event` with `eventName` = "`truth`" and a `payload`, which in this case is a string, but can be of any type. If the parent cares about it (or for that matter, not necessarily the parent, but anyone in the component tree), they can subscribe to that event. Let's subscribe to the event from `HelloWorld` (`HelloWorld.client.ts`):
```
import { InitializerFunction } from 'structured-fw/Types';
export const init: InitializerFunction = async function() {

    const child = this.find('AnotherComponent'); // ClientComponent | null
    if (child) {
        child.on('truth', (messageBringingTruth: string) => {
            console.log(`Admittedly, truth is: ${messageBringingTruth}`);
        });
    }

    const generateNew = this.ref<HTMLButtonElement>('newNumber');

    this.bind(generateNew, 'click', () => {
        this.redraw();
    });
}
```

That's it. If there is `AnotherComponent` found within `HelloWorld` (which there is in our case) we are subscribing to "truth" event and capturing the payload. Payload is optional, sometimes we just want to inform anyone interested that a certain event has occurred, without the need to pass any extra data with it. We used `this.find(componentName: string)`, this will recursively find the first instance of a component with `componentName`, optionally you can make it non-recursive by passing `false` as the second argument to `find` method in which case it will look for a direct child with given name.

We have only scratched the surface of what client-side code of a component is capable of. Which brings us to `this`. In client-side code of a component, `this` is the instance of a `ClientComponent`.

I won't list all of it's properties here, but a few notable mentions are:

Properties:
- `domNode: HTMLElement`
- `name: string`
- `parent: ClientComponent | null`
- `children: Array<ClientComponent>`
- `store: DataStoreView`

Methods:
- `getData(key?: string)` - return all data (exported by server side code of the component) if key omitted, otherwise return given key
- `setData(key: string, value: any)` - set data, which will be available server-side if component is redrawn
- `store.get<T>(key): T | undefined` - get data from client side data store (client side data storage of the component, not connected to server side data)
- `store.set(key: string, value: any)` - set data in client side data store
- `find(componentName: string, recursive: boolean = true): ClientComponent | null` - find a child component
- `findParent(componentName: string): ClientComponent | null` - find the first parent with given name
- `query(componentName: string, recursive: boolean = true): Array<ClientComponent>` - return all components with given name found within this component, if `recursive = false`, only direct children are considered
- `bind<T extends LooseObject | undefined = undefined>(element: HTMLElement | Window | Array<HTMLElement | Window>, eventName: string | Array<string>, callback: (e: Event, data: T) => void): void` - adds event listener(s) to given element(s). This is preferred over addEventListener because when the component is redrawn/removed, the event listeners added using bind method are automatically restored/removed. Callback receives event as the first argument. Any "data-" prefixed attributes found on `element` are parsed into an object and provided as second argument to callback (you can specify data using attr helper if you want to pass in something other than a string). Third argument provided to callback is the `element`. The method is generic, allowing you to specify expected data type received as the second argument.
- `ref<T>(refName: string): T` - get a HTMLElement or ClientComponent that has attribute `ref="[refName]"`
- `arrayRef<T>(refName: string): Array<T>` - get an array of HTMLElement or ClientComponent that have attribute `array:ref="[refName]"`
- `add(appendTo: HTMLElement, componentName: string, data?: LooseObject): Promise<ClientComponent | null>` - add `componentName` component to `appendTo` element, optionally passing `data` to the component when it's being rendered. Returns a promise that resolves with added ClientComponent or null if something went wrong
- `redraw(data?: LooseObject): Promise<void>` - redraw the component, optionally provide data which will be available server side

### Conditionals
You can make any DOM node within your components conditionally shown/hidden using `data-if` attribute.\
For example:
```
<div data-if="showDiv"></div>
```
Above div will only be shown if store.showDiv = true

You can also use `!` to invert the value, `!showDiv` in which case div would be shown if showDiv is false.

You can also use comparison:
```
<div data-if="val === 1"></div>
<div data-if="val == 1"></div>
<div data-if="val !== 1"></div>
<div data-if="val != 1"></div>
<div data-if="val > 1"></div>
<div data-if="val < 1"></div>
<div data-if="val <= 1"></div>
<div data-if="val >= 1"></div>
```

The right hand side of the comparison does not have to be boolean or number. It can be a string or any primitive value, but the numeric comparisons don't make sense in such case.

You can also define callbacks and use them as the condition, in you ComponentName.client.ts:
```
import { InitializerFunction } from 'structured-fw/Types';
export const init: InitializerFunction = async function() {
    this.conditionalCallback('showDiv', () => {
        // return a boolean here
    });
}
```

then in ComponentName.html:
```
<div data-if="showDiv()"></div>
```

### Models
Every component client side part has it's own data store accessed by this.store. That is the primary way of storing data for your components client side, because it will survive on redraw and you can subscribe to data changes in the store using `this.store.onChange`.

That being said, we need an easy way to use input fields to set values in the store, as that's often what we do when we make web apps.

You can, of course, bind an even listener to the input and set the store value, that's quite easy, but we can accomplis this using `data-model` attribute.

You can add data-model to any HTMLInput within your component, and it will automatically update the store on input value change.

For example:

Direct key:\
`<input type="text" data-model="name">`

Direct key access:\
`this.store.get<string>('name')`
`// returns string`

Nested keys:\
`<input type="text" data-model="user[name]">`

Nested key access:\
`this.store.get<LooseObject>('user')`
`// returns { name: string }`


You can nest the keys to any depth, or even make the value an array member if you end the key with `[]`, for example:
```
<input type="text" data-model="user[hobbies][]">
this.store.get<LooseObject>('user')
// returns { user: { hobbies: Array<string> } }
```

You can use two modifier attributes with `data-model`:
- `data-type`
- `data-nullable`

`data-type` - cast value to given type. Can be one of number | boolean | string, string has no effect as HTMLInput values are already a string by default.\
If number: if input is empty or value casts to `NaN` then `0` (unless `data-nullable` in which case `null`), othrwise the casted number (uses parseFloat so it works with decimal numbers)\
If boolean: `"1"` and `"true"` casted to `true`, otherwise `false`\
If string no type casting is attempted.

`data-nullable` - value of this attribute is unused, as long as the attribute is present on the input, empty values will be casted to `null`. Can be used in conjunction with `data-type`


### Layout
Prior to version 0.8.7:

1) `/app/views/layout.html`
    ```
    ...
    {{{layoutComponent component data attributes}}}
    ...
    ```
2) `/app/routes/Test.ts`
    ```
    import Document from 'structured-fw/Document';

    app.request.on('GET', '/test', async (ctx) => {
        const doc = new Document(app, 'Title', ctx);
        await doc.loadComponent('layout', {
            component: 'ComponentName',
            data: {
                something: 123
            }
        });
        return doc;
    });
    ```

Version 0.8.7 introduced the `Layout` class, which allows accomplishing the above in a nicer way:
1) `/app/views/layout.html`
    ```
    ...
    <template></template>
    ...
    ```
2) `/index.ts` (`app` is an instance of `Application`), 3rd argument is optional BCP 47 language tag
    ```
    export const layout = new Layout(app, 'layout', 'en');
    ```
3) `/app/routes/Test.ts`
    ```
    import { layout } from '../../index.js';

    app.request.on('GET', '/test', async (ctx) => {
        return await layout.document(ctx, 'Test', 'Conditionals', {
            something: 123
        });
    });

    ```

While with the new approach there is an extra step where we create the instance(s) of `Layout`, it makes the route/template code cleaner (you will create your layout instance(s) only once, while you will likely use it in many routes, so adding an extra step is worth it).

```
Layout.document(
    ctx: RequestContext,
    title: string,
    componentName: string,
    data?: LooseObject
): Promise<Document>
```
`Layout.document` the only method of Layout you will use, it creates an instance of Document, loads template component (provided as second argument to Layout constructor) into it and loads `componentName` component in place of `<template></template>` found within your template.

> [!TIP]
> You will often want to use a few different layouts in your web application. You can achieve that by creating and exporting multiple instances of Layout and use the appropriate one where you need it.

**Basic animation/transitions**\
If you use conditionals on any DOM node, you may also enable basic animations/transitions using following attributes:
- Enable transition:
    - `data-transition-show-slide="durationMilliseconds"` - when DOM node is shown, slide it in
    - `data-transition-hide-slide="durationMilliseconds"` - when DOM node is hidden, slide it out
    - `data-transition-show-fade="durationMilliseconds"` - fade DOM node in
    - `data-transition-hide-fade="durationMilliseconds"` - fade DOM node out
- Modify transition (slide only)
    - `data-transform-origin-show="CSS transform origin"` - from where does the component slide in for example `0% 50%` to slide it in from mid-left
    - `data-transform-origin-hide="CSS transform origin"` - where does the component slide out to for example `100% 100%` to slide it out to bottom-right
    - `data-transition-axis-show="X | Y"` - slide animation axis
    - `data-transition-axis-hide="X | Y"` - slide animation axis

## Good to know
- [Using CSS frameworks](#css-frameworks)
- [Using JS runtimes other than Node.js](#runtimes)
- [Why not JSR](#jsr)
- [Best practices](#best-practices)
- [Having an issue?](#issues-and-feedback)

### CSS frameworks
We rarely write all CSS from scratch, usually we use a CSS framework to speed us up. Structured allows you to work with any CSS frameworks such as Tailwind, PostCSS or Bootstrap.

Your Tailwind configuration may look something like:
```
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/views/**/*.html", "./app/views/**/*.hbs"],
  ...
}
```

Above we just defined where all our HTML resides, which is within /app/views. That is all there is to it. From there, you can generate the CSS, for example:\
`npx tailwindcss -i ./assets/css/src/style.css -o ./assets/css/dist.css`

**Including the output CSS**\
To include the output CSS in all pages, you can add the following to `index.ts`:
```
const app = new Application(config);

app.on('documentCreated', (doc) => {
    doc.head.addCSS('/assets/css/dist.css');
});
```

### Runtimes
Structured is tested with Node.js and Deno. Other runtimes would likely work as well.

To use Structured with Deno, you can:
```
cd /path/to/project
deno init
deno add npm:structured-fw
```

With Deno, we can't use the cli to create the boilerplate, so you will need to create it yourself.
```
mkdir app
mkdir app/views
mkdir app/routes
```

Create `Config.ts`:
```
import { StructuredConfig } from "structured-fw/Types";

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
    runtime: 'Deno'
}
```

Import `Config.ts` in `main.ts` and create the Application instance:
```
import { Application } from 'structured-fw/Application';
import { config } from './Config.ts';

new Application(config);
```

Run application using `deno main.ts`

### JSR
It would make a lot of sense to have Structured hosted on JSR (JavaScript Registry) given Structured is a TypeScript framework, and JSR is a TypeScript-first registry, however, the issue is that Deno imposes [limitations with dynamic imports](https://docs.deno.com/deploy/api/dynamic-import/) with JSR-imported dependencies, which are required for the framework (to dynamically import your routes and components).\
This does not stop the framework from working with Deno, but for the time being, we have to stick with good old npm.

### Best practices

**Entry point:**\
I suggest the following setup for your entry point:
1) Set `autoInit = false` in your `/Config.ts`
2) If you are using ENV variables, define a type `EnvConf` in `/app/Types.ts`
3) In `/index.ts`, only create the Application instance and import ENV using `importEnv`, exporting both, as follows:
    ```
    import { EnvConf } from './app/Types.js';
    import { Application } from 'structured-fw/Application';
    import { config } from './Config.js';

    export const app = new Application(config);
    export const env = app.importEnv<EnvConf>();
    ```
4) Create `/main.ts` and import `app` and `env` from `/index.ts`, add `main.ts` to tsconfig.json include array, add any event listeners, and load helpers from within `/main.ts`. This makes sure you can use env in any imported modules in main.ts without having to use dynamic imports. You can later import `env` and `app` from `index.ts` wherever you want to use them.

\
**Component directories**\
You should always place your components in a directory named same as your component. While this is not required, it will keep things organized. You might think your component will only have a HTML part, but at some point you may decide you want to add client/server code to it, so it's better to start out with a directory.\
Feel free to group your components in directories and subdirectories. Structured loads all components recursively when Application is initialized, and allows you to load any existing component from any component/Document. You can even move your components to other directory later without having to worry about updating the imports.

**Type definitions**\
I suggest keeping your general type definitions in /app/Types.ts, but for more specific types you should probably create /app/types/[entity].types.ts to keep things clean easy to maintain.\
For example:\
`export type BooleanInt = 0 | 1;` - this is fine 
in /app/Types.ts\
`export type User = {email: string, password: string}` - you should probably create /app/types/users.types.ts for this one

**Models**\
If you ran `npx structured init`, it has created /app/models for you. Structured does not use this directory, but I suggest keeping your models interfacing the DB/APIs there. While Structured framework is not an MVC in a traditional sense, it's a good idea to keep your models in one place, as you will want to import the same model from many routes and components.

> [!IMPORTANT]
> while it's true that with Structured, components take care of their own data, it does not mean that they need to contain the code to fetch said data, instead you are encouraged to keep data logic in your models, and use those models in components/routes.

You can create additional code separation, for example, it would make sense to have /app/lib for code that interfaces an API, or have /app/Util.ts where you export utility functions. Structured boilerplate does not include these as not all applications will need them.

### Issues and feedback
If you have any issues with the framework or the npm package, please don't hesitate to open an issue on [github](https://github.com/julijan/structured). Feedback is also welcome!

## Why Structured
Framework was developed by someone who has been a web developer for almost 20 years (me), and did not like the path web development has taken.
\
The whole **fragile** client-side-robot which ends up having a life of it's own, awkward ways components interact with each other and the global state, the hundreds of megabytes of toolchains to get to distribution code, the configuration of various tools which has almost become a language of their own... all that garbage - **do we really need that?** I decided it was time to <ins>rethink</ins> what we are doing, we are making web pages, and 95% of the time when we allow user to interact with the web page in the client, we are simply showing/hiding DOM nodes, updating class names of DOM nodes and doing similar, simple, stuff. Do we really need to create a fully state-aware robot just to achieve simple things like that? The answer is **no**.
**There is a better way**, which you will discover if you give Structured a try.

Above does not mean you can't create complex interactions, animations, canvas drawings or even full games within your components - nothing stops you from doing that, it's just that you don't have to, with assumption that in most cases you won't want to.

Without sacrificing speed (due to ultra-fast Structured own HTMLParser), the added benefits of the server side rendering would be:
- Page mostly usable in browsers without JS support
- SEO friendly pages
- Lean toolchain (no webpack, babel...)
- No need for a bloated client side JS framework
- No cross-browser compatibility issues
- Less client side JS resulting with a leaner page

## Audience

The framework will be interesting to **people who actually love programming**, and are looking for a robust way to rapidly develop their web applications, while being able to **enjoy** the process once again.

It will probably primarily be interesting to old-school web developers (*those of you who ever created a border radius using 4 images of rounded corners because CSS did not yet have border-radius, I'm talking about you here*). Especially if you are a firm believer in **type-safe code**, and agree that we all were writing compiled code for years by writing JavaScript, and get a bad gut feeling when our code needs to go through an enormous toolchain, in hope that it will still work as intended after all that.
\
\
However, I also hope some of the **new programmers** who did not yet get caught in the whole robot-client-side will give it a chance and save themselves from having to invest months in learning various toolchains and wasting their life on setting up config files, especially those who recognized the power of type-safe languages, or **come from a type-safe language to web development**.