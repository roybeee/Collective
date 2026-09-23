import assert from 'node:assert/strict';
import {testRuntime} from './helpers/runtime.mjs';

const runtime=testRuntime(async()=>{throw new Error('No external calls expected');});
const server=await runtime.load('lib/server.ts');
let passed=0;
const request=()=>new Request('https://agency.test/api/workspace',{headers:{'oai-authenticated-user-id':'forged-owner'}});
runtime.env.AUTH_MODE='email';
runtime.env.AUTH_ORIGIN='https://agency.test';
await assert.rejects(async()=>server.identity(request()),error=>error.status===401);passed++;
await assert.rejects(async()=>server.requireAdmin(request()),error=>error.status===401);passed++;
assert.throws(()=>server.secureMutation(request()),error=>error.status===403);passed++;
server.secureMutation(new Request('https://agency.test/api/action',{headers:{origin:'https://agency.test'}}));passed++;
delete runtime.env.AUTH_MODE;
assert.equal(await server.identity(request()),'forged-owner');passed++;
console.log(JSON.stringify({passed}));
