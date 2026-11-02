const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {createRequire} = require('node:module');
const {test} = require('node:test');
const toolsRequire = createRequire(require.resolve('@genkit-ai/tools-common'));
const AdmZip = toolsRequire('adm-zip');
const {downloadAndExtractUiAssets} = toolsRequire('../utils/ui-assets.js');

test('the actual CLI asset consumer extracts its UI archive with the scoped patched ZIP dependency', async()=>{
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'postcard-ui-assets-'));
  try {
    assert.equal(toolsRequire('adm-zip/package.json').version,'0.6.1');
    const zip=new AdmZip();zip.addFile('ui/browser/index.html',Buffer.from('<html>controlled fixture</html>'));
    await fs.writeFile(path.join(folder,'fixture.zip'),zip.toBuffer());
    // A cached archive selects the real extraction path without external I/O.
    await downloadAndExtractUiAssets({fileUrl:'http://127.0.0.1:1/not-used',extractPath:folder,zipFileName:'fixture.zip'});
    assert.equal(await fs.readFile(path.join(folder,'ui/browser/index.html'),'utf8'),'<html>controlled fixture</html>');
  } finally {await fs.rm(folder,{recursive:true,force:true});}
});

test('the CLI asset consumer cannot overwrite a file through an existing symlink', async()=>{
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'postcard-ui-symlink-'));
  try {
    const target=path.join(folder,'outside.txt');await fs.writeFile(target,'must survive');
    const destination=path.join(folder,'assets');await fs.mkdir(destination);
    await fs.symlink(target,path.join(destination,'index.html'));
    const zip=new AdmZip();zip.addFile('index.html',Buffer.from('unsafe overwrite'));
    await fs.writeFile(path.join(destination,'fixture.zip'),zip.toBuffer());
    await downloadAndExtractUiAssets({fileUrl:'http://127.0.0.1:1/not-used',extractPath:destination,zipFileName:'fixture.zip'});
    assert.equal(await fs.readFile(target,'utf8'),'must survive');
  } finally {await fs.rm(folder,{recursive:true,force:true});}
});

test('malformed compressed ZIP data reports an error instead of crashing the process', {timeout:3000}, async()=>{
  const zip=new AdmZip();zip.addFile('test.txt',Buffer.from('controlled compressed payload '.repeat(40)));
  const bytes=zip.toBuffer();const start=30+bytes.readUInt16LE(26)+bytes.readUInt16LE(28);
  const length=bytes.readUInt32LE(18);assert.ok(length>0);
  for(let i=start;i<start+length;i++)bytes[i]^=0xff;
  const bad=new AdmZip(bytes);
  await new Promise((resolve,reject)=>bad.getEntries()[0].getDataAsync((data,error)=>{
    try{assert.ok(error);resolve();}catch(failure){reject(failure);}
  }));
});
