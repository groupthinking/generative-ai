// Child-process-only I/O adapters. Production code never imports this fixture.
const Module = require('node:module');
const fs = require('node:fs');
const originalLoad = Module._load;
// Keep CLI caches and auth lookup inside the test's temporary directory.
require('node:os').homedir = () => process.env.POSTCARD_TEST_HOME;
const record = (kind, value) => fs.appendFileSync(process.env.POSTCARD_TEST_LOG, JSON.stringify({kind,value})+'\n');
const allowed = (url) => ['localhost','127.0.0.1','[::1]','::1'].includes(url.hostname);
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, ...args) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (!allowed(url)) throw new Error('External fetch blocked by postcard test: '+url.hostname);
  return originalFetch(input,...args);
};
for (const protocol of ['http','https']) {
  const module = require('node:'+protocol);
  const request = module.request;
  module.request = function(input, ...args) {
    const url = typeof input === 'string' || input instanceof URL ? new URL(input) : {hostname:input.hostname || input.host || 'localhost'};
    if (!allowed(url)) throw new Error('External request blocked by postcard test: '+url.hostname);
    return request.call(this,input,...args);
  };
}
Module._load = function(request, parent, ...rest) {
  if (process.env.POSTCARD_TEST_MODE === 'controlled') {
    if (request === '@/libs/maps/maps' || /[/\\]libs[/\\]maps[/\\]maps(?:\.ts)?$/.test(request)) {
      return {renderMap:async (...args)=>{record('map',args);return 'bWFwLWZpeHR1cmU=';}};
    }
    if (request === '@genkit-ai/google-cloud') {
      return {enableGoogleCloudTelemetry:async(options)=>{record('telemetry',options);}};
    }
    if (request === '@genkit-ai/vertexai') {
      return {vertexAI:()=>{
        const {genkitPlugin}=require('genkit/plugin');
        return genkitPlugin('vertexai',async(ai)=>{
          ai.defineModel({name:'vertexai/gemini-2.0-flash',supports:{media:true,output:['json','text']}},async(request)=>{
            record('map-model',request);
            return {message:{role:'model',content:[{text:JSON.stringify({description:'Controlled route description',story:'Controlled postcard story'})}]},finishReason:'stop',usage:{inputTokens:1,outputTokens:1,totalTokens:2}};
          });
          ai.defineModel({name:'vertexai/imagen3',supports:{media:true,output:['media']}},async(request)=>{
            record('image-model',request);
            return {message:{role:'model',content:[{media:{url:'data:image/png;base64,aW1hZ2UtZml4dHVyZQ==',contentType:'image/png'}}]},finishReason:'stop',usage:{inputTokens:1,outputTokens:1,totalTokens:2}};
          });
        });
      }};
    }
  }
  return originalLoad.call(this,request,parent,...rest);
};
