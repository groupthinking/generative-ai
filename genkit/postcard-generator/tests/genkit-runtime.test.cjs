const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {spawn,spawnSync} = require('node:child_process');
const {test} = require('node:test');
const project = path.resolve(__dirname,'..');
const fixture = path.join(__dirname,'fixtures/genkit-runtime.cjs');
const delay = (ms) => new Promise(resolve=>setTimeout(resolve,ms));

async function withRuntime(mode, check) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(),'postcard-genkit-'));
  const id = `postcard-test-${process.pid}-${mode}-${Date.now()}`;
  const log = path.join(temporary,'providers.jsonl');
  await fs.writeFile(log,'');
  const configFolder=path.join(temporary,'config');
  const configPath=path.join(configFolder,'configstore','@genkit-ai');
  await fs.mkdir(configPath,{recursive:true});
  await fs.writeFile(path.join(configPath,'tools-common.json'),JSON.stringify({analytics_notification:true,userSettings:{analyticsOptOut:true}}));
  const env = {
    PATH:process.env.PATH, HOME:process.env.HOME, TMPDIR:os.tmpdir(), CI:'true', XDG_CONFIG_HOME:configFolder,
    GOOGLE_CLOUD_PROJECT:'postcard-controlled-fixture',
    GOOGLE_MAPS_API_SERVER_KEY:'fixture-not-a-real-key',
    ENV_FILE_LOCATION:path.join(temporary,'absent.env'),
    GENKIT_RUNTIME_ID:id,
    NODE_OPTIONS:`--require ${JSON.stringify(fixture)}`,
    POSTCARD_TEST_MODE:mode, POSTCARD_TEST_LOG:log, POSTCARD_TEST_HOME:temporary,
  };
  const child=spawn(process.platform==='win32'?'npm.cmd':'npm',['run','genkit:dev'],{cwd:project,env,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
  let runtimeFile;
  try {
    const until=Date.now()+30000;
    let runtime;
    while(Date.now()<until) {
      if(child.exitCode!==null) throw new Error(`Dev command exited ${child.exitCode}:\n${output}`);
      const folder=path.join(project,'.genkit/runtimes');
      for(const name of await fs.readdir(folder).catch(()=>[])) {
        const file=path.join(folder,name);
        const data=await fs.readFile(file,'utf8').then(JSON.parse).catch(()=>null);
        if(data?.id===id){runtime=data;runtimeFile=file;break;}
      }
      if(runtime) break;
      await delay(100);
    }
    assert.ok(runtime,`The actual command did not register a runtime:\n${output}`);
    assert.equal(new URL(runtime.reflectionServerUrl).hostname,'localhost');
    const response=await fetch(runtime.reflectionServerUrl+'/api/actions');
    assert.equal(response.status,200,await response.clone().text());
    const actions=await response.json();
    assert.ok(actions['/flow/Postcard Flow'],'Shared postcard flow must be discoverable');
    assert.ok(actions['/model/vertexai/gemini-2.0-flash'],'Map model must be registered');
    assert.ok(actions['/model/vertexai/imagen3'],'Image model must be registered');
    assert.ok(actions['/model/ollama/gemma2:9b'],'Ollama feature must remain registered');
    assert.equal(actions['/flow/Postcard Flow'].inputSchema.properties.stops.type,'array');
    const cleanOutput=output.replace(/\x1b\[[0-9;]*m/g,'');
    const uiUrl=cleanOutput.match(/Genkit Developer UI:\s+(http:\/\/localhost:\d+)/)?.[1];
    assert.ok(uiUrl,`CLI must start its API server: ${cleanOutput}`);
    // Check the actual CLI manager-to-runtime protocol, not only reflection.
    let listing;
    // Runtime file creation and the CLI's filesystem watcher are asynchronous.
    while(Date.now()<until) {
      const listed=await fetch(uiUrl+'/api/listActions?input='+encodeURIComponent(JSON.stringify({runtimeId:id})));
      listing=await listed.json();
      if(listed.ok && listing.result?.data?.['/flow/Postcard Flow'])break;
      await delay(100);
    }
    assert.ok(listing.result?.data?.['/flow/Postcard Flow'],`CLI must discover the shared runtime flow: ${JSON.stringify(listing)}`);
    await check({runtime,actions,log,uiUrl,output:()=>output});
  } finally {
    if(child.exitCode===null) {
      if(process.platform==='win32')child.kill('SIGTERM');
      else {try{process.kill(-child.pid,'SIGTERM');}catch(error){if(error.code!=='ESRCH')throw error;}}
      await Promise.race([new Promise(resolve=>child.once('exit',resolve)),delay(3000)]);
      if(child.exitCode===null && process.platform!=='win32'){try{process.kill(-child.pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}}
    }
    if(runtimeFile)await fs.rm(runtimeFile,{force:true});
    await fs.rm(temporary,{recursive:true,force:true});
  }
}

test('actual pinned dev command registers the existing flow and real provider plugins', {timeout:45000}, async()=>{
  await withRuntime('registration',async({log})=>{
    assert.equal(await fs.readFile(log,'utf8'),'','Registration must not execute cloud telemetry, maps or models');
  });
});

test('developer runtime executes shared prompts through real Genkit and rejects invalid input before adapters', {timeout:45000}, async()=>{
  await withRuntime('controlled',async({runtime,log,uiUrl})=>{
    const endpoint=uiUrl+'/api/runAction';
    const invalid=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({runtimeId:runtime.id,key:'/flow/Postcard Flow',input:{start:42}})});
    assert.notEqual(invalid.status,200);
    assert.equal(await fs.readFile(log,'utf8'),'','Invalid input must not reach any provider adapter');
    const input={start:'London',end:'Paris',stops:['Dover'],sender:'Alice',recipient:'Bob'};
    const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({runtimeId:runtime.id,key:'/flow/Postcard Flow',input})});
    const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));
    assert.deepEqual(body.result,{description:'Controlled route description',story:'Controlled postcard story',image:'data:image/png;base64,aW1hZ2UtZml4dHVyZQ==',map:'data:image/png;base64,bWFwLWZpeHR1cmU='});
    const events=(await fs.readFile(log,'utf8')).trim().split('\n').map(JSON.parse);
    assert.deepEqual(events.map(e=>e.kind),['telemetry','map','map-model','image-model']);
    assert.deepEqual(events[1].value,['London','Paris',['Dover']]);
    const mapPrompt=JSON.stringify(events[2].value.messages);
    for(const text of ['London','Paris','Alice','Bob','data:image/png;base64,bWFwLWZpeHR1cmU='])assert.ok(mapPrompt.includes(text),text);
    assert.ok(JSON.stringify(events[3].value.messages).includes('Controlled postcard story'));
  });
});


test('runtime entrypoint fails closed outside dev mode and without the existing Maps configuration', async()=>{
  const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'postcard-dev-failure-'));
  try {
    const runner=path.join(path.dirname(require.resolve('tsx/package.json')),'dist/cli.mjs');
    const env={PATH:process.env.PATH,ENV_FILE_LOCATION:path.join(temporary,'absent.env'),GOOGLE_CLOUD_PROJECT:'postcard-controlled-fixture',POSTCARD_TEST_HOME:temporary,NODE_OPTIONS:`--require ${JSON.stringify(fixture)}`};
    for(const [overrides,message] of [[{},'Start this runtime with npm run genkit:dev'],[{GENKIT_ENV:'dev'},'GOOGLE_MAPS_API_SERVER_KEY is not defined']]) {
      const result=spawnSync(process.execPath,[runner,'libs/genkit/dev.ts'],{cwd:project,env:{...env,...overrides},encoding:'utf8',timeout:15000});
      assert.equal(result.error,undefined);assert.equal(result.status,1,result.stdout+result.stderr);
      assert.ok(result.stderr.includes(message),result.stderr);
    }
  } finally {await fs.rm(temporary,{recursive:true,force:true});}
});
