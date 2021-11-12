#!/usr/bin/env node

import fetch from "node-fetch";
import { randomBytes } from "crypto";
import color from "colors";
import enquirer from "enquirer";
const { AutoComplete, Input, Select, MultiSelect, Snippet } = enquirer;
import fs from "fs";
import { spawnSync} from "child_process";

/* ------------------------------------- Global Configuration ---------------------------------------------- */

const configPath = new URL("./.config", import.meta.url);
let config = {};

function loadConfig() {
    if(!fs.existsSync(configPath)) {
        console.log(`No config found at ${configPath}`);
        config.sessionToken = randomBytes(20).toString("hex");
        config.hostname = "corona-school-backend-dev";
        config.authToken = "authtokenS1";
        config.queries = {};
        config.mutations = {};
    } else {
        config = JSON.parse(fs.readFileSync(configPath));
    }
}

function storeConfig() {
    fs.writeFileSync(configPath, JSON.stringify(config));
}

async function login() {
    console.log(`Starting Session ${config.sessionToken}`);

    config.hostname = await (new Input({ message: "Server URL (.herokuapp.com)", initial: config.hostname, })).run();
    config.authToken = await (new Input({ message: "Login Token", initial: config.authToken })).run();

    await runQuery(`mutation { loginLegacy(authToken: "${config.authToken}") }`);

    console.log(color.green(`Authentication successful`));
    storeConfig();
}

/* ------------------------------------- Query Runner ---------------------------------------------- */

async function runQuery(query, variables, silent) {
    if(!silent) {
        console.log("Starting to run query");
        console.log(color.blue(query));
    }

    const response = await fetch(`https://${config.hostname}.herokuapp.com/apollo`, {
        method: "POST",
        headers: {
            "authorization": `Bearer ${config.sessionToken}`,
            "content-type": "application/json"
        },
        body: JSON.stringify({ query, variables })
    });

    if(!response.ok) {
        console.error(color.red(`HTTP Error ${response.status} occured. Message:`));
        console.error(await response.text());
        throw new Error(`HTTPError`);
    }

    const result = await response.json();

    if(result.errors) {
        console.error(color.red(`Errors occured running the query:`));
        for(const error of result.errors) {
            console.error(color.red(` - ${error.message}`));
        }

        console.log(`\n\n`);

        throw new Error(`QueryError`);
    }

    const tracing = result.extensions.tracing;

    if(!silent) {
        console.log(color.green(`Query run successfully in ${Math.floor(tracing.duration / 1000000)}ms:`));
        console.log(color.blue(JSON.stringify(result.data, null, 2)));
    }
    return result.data;
}

/* ------------------------------------- Introspection ---------------------------------------------- */

function getTypeName(type) {
    if(type.name)
        return type.name;

    if(!type.ofType)
        throw new Error(`Cannot get type for ${JSON.stringify(type)}`);

    return getTypeName(type.ofType);
}
const introspectionFieldsCache = { };

async function introspectFields(path) {
    if(introspectionFieldsCache[path.join()]?.fields)
        return introspectionFieldsCache[path.join()].fields;

    let type = "Query";

    if(path.length > 0) {
        const prev = path.slice(0, -1);
        await introspectFields(prev);
        const entry = introspectionFieldsCache[path.join()];
        if(!entry)
            throw new Error(`Failed to inspect ${path.join()}`);

        type = entry.type;
    }

    let result = await runQuery(
        `query {  __type(name: "${type}") { name fields { name type { name ofType { name ofType { name ofType { name ofType { name }}}}}}}}`,
        undefined, true
    );

    const fields = [];

    for(const field of result.__type?.fields ?? []) {
        const fieldPath = [...path, field.name].join();
        introspectionFieldsCache[fieldPath] = { type: getTypeName(field.type) };
        fields.push(field.name);
    }

    introspectionFieldsCache[path.join()] = { fields, type };

    return fields;
}

let introspectionMuationCache = null;

async function introspectMutations() {
    if(introspectionMuationCache)
        return introspectionMuationCache;
    

    const result = await runQuery(
        `query {  __type(name: "Mutation") { name fields { name type { name ofType { name } } args { name } } }}`,
            undefined, true
    );

    introspectionMuationCache = result.__type.fields.map(it => ({ name: it.name, args: it.args }));
}

/* ------------------------------------- Query Commands ---------------------------------------------- */

function queryTreeToString(query) {
    let queryString = `query {\n`;
    
    function addQuery(query, depth) {
        for(const [key, { fields }] of Object.entries(query)) {
            queryString += " ".repeat(depth) + key;
            if(Object.keys(fields).length) {
                queryString += ` {\n`;
                addQuery(fields, depth + 2);
                queryString += " ".repeat(depth) + `}\n`;
            } else queryString += `\n`;
        } 
    }
    addQuery(query, 2);
    queryString += `}`;

    return queryString;
}

async function editQuery(queryString, name) {
    const tmpFile = new URL("./.query", import.meta.url);
    fs.writeFileSync(tmpFile, queryString);
    spawnSync("vim", [tmpFile], { stdio: "inherit" });
    const result = fs.readFileSync(tmpFile, { encoding: "utf-8" });

    return executeQuery(result, name);
}

async function storeQuery(queryString, name) {
    name = await (new Input({ description: "Query Name", initial: name })).run();
    config.queries[name] = queryString;
    storeConfig();
}

async function loadQuery() {
    const storedQueries = Object.keys(config.queries);

    const name = await (new Select({ choices: storedQueries })).run();
    
    return executeQuery(config.queries[name], name);
}

async function executeQuery(queryString, name) {
        console.clear();
        await runQuery(queryString);

        const op = await (new Select({ choices: ["rerun", "edit", "store", "exit", "new query"]})).run();
        if(op === "rerun") {
            return executeQuery(queryString, name);
        } else if(op === "edit") {
            return editQuery(queryString, name);
        } else if(op === "new query") {
            return buildQuery();
        } else if(op === "store") {
            return storeQuery(queryString, name);
        } else if(op === "exit") {
            return;
        }
    
}

async function buildQuery() {
    const query = {};

    const pathsToFill = [[]];

        while(pathsToFill.length) {
            const path = pathsToFill.pop();
            const parentNode = path.reduce((acc, it) => acc[it].fields, query);

            const fields = await introspectFields(path);
            if(!fields.length) continue;

            fields.sort();
            
            let chosenFields;
            do {
                console.clear();
                chosenFields = await (new MultiSelect({ 
                    message: `fields for ${path.join(` > `)}`,
                    choices: fields
                    
                })).run();
            } while(!chosenFields.length)

            for(const field of chosenFields) {
                const fieldPath = [...path, field];
                pathsToFill.push(fieldPath);
                parentNode[field] = { fields: {} };
            }
        }

        return executeQuery(queryTreeToString(query));
}

/* ------------------------------------- Mutation Commands ---------------------------------------------- */


async function editMutation(queryString, name) {
    const tmpFile = new URL("./.query", import.meta.url);
    fs.writeFileSync(tmpFile, queryString);
    spawnSync("vim", [tmpFile], { stdio: "inherit" });
    const result = fs.readFileSync(tmpFile, { encoding: "utf-8" });

    return executeMutation(result, name);
}

async function storeMutation(queryString, name) {
    name = await (new Input({ description: "Mutation Name", initial: name })).run();
    config.mutations[name] = queryString;
    storeConfig();
}

async function loadMutation() {
    const storedMutations = Object.keys(config.mutations);

    const name = await (new Select({ choices: storedMutations })).run();
    
    return executeMutation(config.mutations[name], name);
}

async function executeMutation(mutationString, name) {
    console.clear();
    await runQuery(mutationString);

    const op = await (new Select({ choices: ["edit", "store", "exit", "new mutation"]})).run();
    if(op === "rerun") {
        return executeMutation(queryString, name);
    } else if(op === "edit") {
        return editMutation(queryString, name);
    } else if(op === "new mutation") {
        return buildMutation();
    } else if(op === "store") {
        return storeMutation(queryString, name);
    } else if(op === "exit") {
        return;
    }
}

async function buildMutation() {
    const mutations = await introspectMutations();
    const mutationName = await (new Select({ choices: mutations.map(it => it.name) })).run();
    const mutation = mutations.find(it => it.name === mutationName);

    let chosenArgs;
    if(mutation.args > 2) {
        await (new MultiSelect({ choices: mutation.args.map(it => it.name) })).run();
    } else {
        chosenArgs = mutation.args.map(it => it.name);
    }

    let mutationString = `mutation {\n  ${mutation.name}(\n`;

    for(const arg of chosenArgs) {
        mutationString += `    ${arg}: \${${arg}}\n`;
    }
    mutationString += `  )\n}`;

    mutationString = (await (new Snippet({ required: true, template: mutationString, fields: chosenArgs.map(it => ({ name: it })) })).run()).result;
    
    return executeMutation(mutationString);
}

/* ------------------------------------- Main ---------------------------------------------- */

(async function main() {
    loadConfig();
    await login();

    await introspectMutations();

    await introspectFields([]);

    console.clear();
    console.log(color.green(`Setup successful, happy hacking!`));
    
    while(true) {
        console.clear();
        const op = await (new Select({ 
            choices: [`create query`, `load query`, `create mutation`, `load mutation`]
        })).run();

        if(op === "create query") {
            await buildQuery();
        } else if(op === "load query") {
            await loadQuery();
        } else if(op === "create mutation") {
            await buildMutation();
        } else if(op === "load mutation") {
            await loadMutation();
        }

    }
    
})();