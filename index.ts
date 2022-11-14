import { Application } from './system/server/Application.js';
import { Document } from './system/server/Document.js';
import { writeFileSync } from 'node:fs';
import * as path from 'path';

const app = new Application(9090);

app.session.start();

app.addRequestHandler(['GET'], '/', async ({ request, response }) => {
    console.log(request.headers['cookie']);
    response.write('hi');
});

app.addRequestHandler(['GET'], '/delay', ({ response }) => {
    return new Promise((resolve, reject) => {
        response.write('hi');
        setTimeout(() => {
            resolve(null);
        }, 20000);
    })
});

app.addRequestHandler(['GET'], '/home', async (ctx) => {
    ctx.response.write('home');
});

app.addRequestHandler(['GET'], '/users/(userId:num)', async ({ response, args }) => {
    response.write(`UserID: ${args.userId}`);
});

app.addRequestHandler(['GET'], '/test/(a:num)/(b)', async ({ response, args }) => {
    response.write(`a:${args.a}\n`);
    response.write(`a type:${typeof args.a}\n`);
    response.write(`b:${args.b}\n`);
    response.write(`b type:${typeof args.b}`);
    let doc = new Document(app, 'test');
    response.write(doc.toString());
});

app.addRequestHandler(['GET'], '/todo', async ({ response }) => {
    let doc = new Document(app, 'Todo list');
    doc.head.addCSS('/assets/css/style.css');
    doc.head.addJS('/assets/js/test.js');
    await doc.loadView('pages/todo');
    response.write(doc.toString());
});

app.addRequestHandler(['POST'], '/todo', async (ctx) => {
    // create a todo task
    let todoList = app.component('TodoList');

    if (todoList?.module && ctx.body) {
        ctx.body.createdAt = new Date().getTime().toString();
        await todoList.module.create(ctx.body);
    }

    app.redirect(ctx.response, '/todo');
});

app.addRequestHandler(['GET'], '/todo/delete/(id)', async (ctx) => {
    // create a todo task
    let todoList = app.component('TodoList');

    if (todoList?.module) {
        await todoList.module.delete(ctx.args.id);
    }

    app.redirect(ctx.response, '/todo');
});

app.addRequestHandler(['GET'], '/upload', async ({ response }) => {
    let doc = new Document(app, 'Upload');
    await doc.loadView('/pages/upload');
    response.write(doc.toString());
});

app.addRequestHandler(['POST'], '/upload', async (ctx) => {
    if (ctx.files) {
        let filePath = path.resolve('../assets/uploads/' + ctx.files.file.fileName);
        console.log(filePath);
        writeFileSync(filePath, ctx.files.file.data);
    }
});


app.on('beforeRequestHandler', async (ctx) => {
    console.log('About to handle request', ctx.request.url);
    if (! ctx.data.requestStart) {
        ctx.data.requestStart = {}
    }

    ctx.data.requestStart[ctx.request.url || ''] = new Date().getTime();
});

app.on('afterRequestHandler', async (ctx) => {
    let timeStart = ctx.data.requestStart[ctx.request.url || ''];
    let time = new Date().getTime() - timeStart;
    console.log(`${ctx.request.method} ${ctx.request.url} handled in ${time}ms`);
});

app.on('serverStarted', async () => {
    console.log('server has been started');
});