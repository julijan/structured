#!/usr/bin/env node

// Structured init script
// meant to be executed after installing Structured framework to set up basic boilerplate
import { resolve } from 'path';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';

// we are in /build/system/bin when this runs, go up 3 levels so cwd points to project root
const cwd = resolve(import.meta.dirname, '../../../');
const projectRoot = resolve('.');

if (process.argv.length < 3) {
    // executed with no commands
    console.log('Thanks for using the Structured framework.');
    console.log(`To set up a basic boilerplate in ${projectRoot} run:\n npx structured init`);
    process.exit();
}


const command = process.argv[2];

function copyIfNotExists(src: string, dst?: string) {
    if (typeof dst !== 'string') {
        dst = src;
    }
    if (existsSync(`${cwd}/${src}`) && ! existsSync(`${projectRoot}/${dst}`)) {
        console.log(`Creating ${dst}`);
        cpSync(`${cwd}/${src}`, `${projectRoot}/${dst}`);
    }
}

function createDir(path: string) {
    if (! existsSync(`${projectRoot}/${path}`)) {
        console.log(`Creating directory ${projectRoot}/${path}`);
        mkdirSync(`${projectRoot}/${path}`);
    }
}

function createTsconfig() {
    const tsconfigPath = `${projectRoot}/tsconfig.json`;
    const exists = existsSync(tsconfigPath);

    const paths = {
        "/assets/ts/*": ["./assets/ts/*"],
        "/assets/client-js/*": ["./system/*"],
        "@structured/*": [
            "./node_modules/structured-fw/build/system/server/*",
            "./node_modules/structured-fw/build/system/client/*",
            "./node_modules/structured-fw/build/system/*",
            "./system/server/*",
            "./system/client/*",
            "./system/*",
        ]
    }

    if (exists) {
        console.log('Updating tsconfig.json, adding @structured to compilerOptions.paths');
        // tsconfig exists, add @structured paths
        const config = JSON.parse(readFileSync(tsconfigPath).toString());

        if (! config.compilerOptions) {
            config.compilerOptions = {}
        }

        if (! config.compilerOptions.paths) {
            config.compilerOptions.paths = paths;
        }

        writeFileSync(tsconfigPath, JSON.stringify(config, null, 4));
    } else {
        console.log('Creating tsconfig.json');
        // tsconfig does not exist, create it
        const config = {
            "compilerOptions": {
                "noImplicitAny": true,
                "noUnusedLocals": true,
                "noImplicitReturns": true,
                "alwaysStrict": true,
                "strictNullChecks": true,
                "strictPropertyInitialization": true,
                "strictBindCallApply": true,
                "moduleResolution" : "bundler",
                "outDir": "./build",
                "module": "ES2020",
                "target": "ES2021",
                "allowSyntheticDefaultImports": true, // albe to do import { default as varname } from 'module'
                "preserveSymlinks": true,
                "removeComments": true,
                "baseUrl": ".",
                "rootDir": ".",
                paths
            },
            "include": ["./system/**/*", "./app/**/*", "./assets/ts/**/*", "index.ts"]
        }

        writeFileSync(tsconfigPath, JSON.stringify(config, null, 4));
    }
}

if (command === 'init') {
    console.log('Setting up a basic Structured boilerplate...');
    createDir('app');
    createDir('app/routes');
    createDir('app/views');
    createDir('app/models');
    createDir('app/lib');
    copyIfNotExists('index.ts');
    copyIfNotExists('Config.ts');
    copyIfNotExists('app/Types.ts');
    createTsconfig();

    console.log(`Structured initialized, you can run "tsc" to build`);
} else {
    console.log(`Command "${command}" not recognized`);
}