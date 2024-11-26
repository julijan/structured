# Structured
Production-tested Node.js framework for creating performant **server-side rendered** web apps and APIs, with a sane amount of client side abstraction.

Framework allows the developer to develop self-contained components which are rendered server side and allows rendering a subset of components on demand. In addition to that, it includes versatile routing (including decoding of request body), session and cookie handling, easy environment variable access, form validation utilities and a templating engine (Handlebars).

It works with Node.js and Deno runtimes. Other runtimes are not tested.

- [Why Structured](#why-structured)
- [Audience](#audience)


### Key concepts:
* [Route](#route)
* [Document](#document)
* [ClientComponent](#component) (component)

## Route
Routes are the first thing that gets executed when your application receives a request. They are a mean for the developer to dictate what code gets executed depending on the URL. In addition to that, they allow capturing parts of the URL for use within the route.
\
\
**Simple route:**
```
app.request.on('GET', '/hello/world', async () => {
    return 'Hello, world!';
});
```
\
**Capture URL segment:**
```
app.request.on('GET', '/greet/(name)', async (ctx) => {
    return `Hello, ${ctx.args.name}!`;
});
```



## Document
Document does not differ much from a component, in fact, it extends Component. It has a more user-firendly API than Component. Each Document represents a web page. It has a head and body. Structured intentionally does not differentiate between a page and a Component - page is just a component that loads many other components in a desired layout. DocumentHead (each document has one at Document.head) allows adding content to `<head>` section of the output HTML page.

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

## Component
A component is comprised of 1-3 files. It always must include one HTML file, while server side and client side files are optional.
* HTML file preobably requires no explanation
* server side file, code that runs on the server and makes data available to HTML and client side code
* client side file, code that runs on the client (in the browser)

You should never need to instantiate a Component on your own. You will always load a Component representing your page into a document (using `Document.loadComponent(componentName: string)`), which will know what to do from there.

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
- Components HTML file can have a `.hbs` extension (which allows for better Handlebars sytax highlighting)
- Components can reside at any depth in the file structure

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

That was the simplest possible example, let's make it more interesting.
Create a new file `/app/views/HelloWorld/HelloWorld.ts`:
```
import { ComponentScaffold } from 'system/Types.js';
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

Let's make it even more interesting by adding some client side code to it.
Create `/app/views/HelloWorld/HelloWorld.client.ts`:
```
import { InitializerFunction } from 'system/Types.js';
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
import { ComponentScaffold } from 'system/Types.js';
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
which is now avaialble in `AnotherComponent` HTML, we assigned the received number to `parentSuggests`, while `betterNumber` is `parentSuggests + 5`, we now have these 2 available and ready to use in our HTML template.

What about client side? **By default, data returned by server side code is not available in client side code** for obvious reasons, let's assume your server side code returns sensitive data such as user's password, you would not like that exposed on the client side, hence exporting data needs to be explicitly requested in the server side code. There are two ways to achieve this, setting `exportData = true` (exports all data), or `exportFields: Array<string> = [...keysToExport]` (export only given fields).

Let's create a client side code for `AnotherComponent` and export the `betterNumber` to it, create `/app/views/AnotherComponent/AnotherComponent.client.ts`:
```
import { InitializerFunction } from 'system/Types.js';
export const init: InitializerFunction = async function() {
    const betterNumber = this.getData<number>('betterNumber');

    alert(`Did you know that your actual lucky number is ${betterNumber}?`);
}
```

And let's update `AnotherComponent.ts` to export `betterNumber`:
```
import { ComponentScaffold } from 'system/Types.js';
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
import { InitializerFunction } from 'system/Types.js';
export const init: InitializerFunction = async function() {
    const betterNumber = this.getData<number>('betterNumber');

    alert(`Don't listen to what ${this.parent.name} said! Your actual lucky number is ${betterNumber}?`);
}
```
Here we accessed the `parent` and obtained it's `name`.

*"But we did not send any data to the parent here"* - correct, we did not, and we won't, instead we can inform them we have some data available, or that an event they might be interested in has ocurred, and if they care, so be it:
```
import { InitializerFunction } from 'system/Types.js';
export const init: InitializerFunction = async function() {
    const betterNumber = this.getData<number>('betterNumber');

    this.emit('truth', `You lied, their lucky number is actually ${betterNumber}`);
}
```

We emitted an `event` with `eventName` = "`truth`" and a `payload`, which in this case is a string, but can be of any type. If the parent cares about it (or for that matter, not necessarily the parent, but anyone in the component tree), they can subscribe to that event. Let's subscribe to the event from `HelloWorld` (`HelloWorld.client.ts`):
```
import { InitializerFunction } from 'system/Types.js';
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

That's it. If there is `AnotherComponent` found within `HelloWorld` (which there is in our case) we are subscribing to "truth" event and capturing the payload. Payload is optional, sometimes we just want to inform anyone interested that a certain event has ocurred, without the need to pass any extra data with it. We used `this.find(componentName: string)`, this will recursively find the first instance of a component with `componentName`, optionally you can make it non-recursive by passing `false` as the second argument to `find` method in which case it will look for a direct child with given name.

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
- `query(componentName: string, recursive: boolean = true): Array<ClientComponent>` - return all components with given name found within this component, if `recurive = false`, only direct children are considered
- `ref<T>(refName: string): T` - get a HTMLElement or ClientComponent that has attribute `ref="[refName]"`
- `arrayRef<T>(refName: string): Array<T>` - get an array of HTMLElement or ClientComponent that have attribute `array:ref="[refName]"`
- `add(appendTo: HTMLElement, componentName: string, data?: LooseObject)` - add `componentName` component to `appendTo` element, optionally passing `data` to the component when it's being rendered

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