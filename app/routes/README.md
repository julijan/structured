Routes:

You can add routes directly in index.ts using app.addRequestHandler
but in order to avoid clutter and keep the code readable, you should add the routes here (/app/routes)

All files in this directory will be loaded once the server is started,
so feel free to separate your routes in as many files as you feel makes sense, eg. it would make sense
to have Auth.ts that would add routes for everything auth related, such as /login, /register, etc...

Example:

export default async function(app: Application) {

    app.addRequestHandler('GET', '/login', async (ctx) => {
        // ctx is a RequestContext
        ctx.response.write('Login page');
    });

    app.addRequestHandler('GET', '/login', async (ctx) => {
        // ctx is a RequestContext
        ctx.response.write('Login page');
    });

}