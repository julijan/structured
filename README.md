Node.js framework for creating server-side rendered web apps and API's.

Idea is to allow the developer to develop self-contained, independent components which are rendered server side and allow rendering only a subset of components when the need arises thus still having the same benefits that clinet side frameworks offer.

The framework allows the developer to rely as much or as little on client side rendering. Entire web app could be rendered on the server, but it's also possible to render the entire page using a client side framework, and only develop the API's.

Without sacrificing speed, the added benefits of the server side rendering would be:
- SEO friendly pages
- Page usable in browsers without JS support
- Leaner toolchain (no webpack, babel...)
- No need for a client side JS framework
- No cross-browser compatibility issues
- Less client side JS resulting with a leaner page

The framework would consist of server side code (Node.js), and a much smaller client-side code. Client side would provide the utilities for the developer to interact with the server.

Page would render on the server outputting the rendered DOM and which includes the client-side JS.
Developer would be able to request the entire page, or any specific component to be re-rendered at their will.

TODO:
- [DONE] complete the component system
- [DONE] templating engine
- [DONE] sessions
- [DONE] file uploads
- [DONE] form validation
- client side part that allows partial rendering
- emails
- gzip support