import { Application } from './system/server/Application.js';

const app = new Application(9090);

// app.on('beforeRequestHandler', async (ctx) => {
//     console.log('About to handle request', ctx.request.method, ctx.request.url);
//     if (! ctx.data.requestStart) {
//         ctx.data.requestStart = {}
//     }

//     ctx.data.requestStart[ctx.request.url || ''] = new Date().getTime();
// });

// app.on('afterRequestHandler', async (ctx) => {
//     let timeStart = ctx.data.requestStart[ctx.request.url || ''];
//     let time = new Date().getTime() - timeStart;
//     console.log(`${ctx.request.method} ${ctx.request.url} handled in ${time}ms`);
// });

// app.on('serverStarted', async () => {
//     console.log('server has been started');
// });