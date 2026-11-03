import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const ownRoot=fileURLToPath(new URL('../',import.meta.url));
const history=JSON.parse(fs.readFileSync(path.join(ownRoot,'sdk-guidance-history.json'),'utf8'));
const ignored=new Set(['.git','node_modules','.vercel','.cache','.sdk101']);
const stale=new RegExp('@arkiv-network/sdk@1\\.0\\.0(?![\\d.-])|SDK[\\s`*_]+1\\.0\\.0(?![\\d.-])|"@arkiv-network/sdk"\\s*:\\s*"1\\.0\\.0"','gi');
const digest=text=>createHash('sha256').update(text.replaceAll('\r\n','\n')).digest('hex');

export function violations(file,text,parseMap=true){
  const allowance=history.find(item=>item.file===file&&item.sha256===digest(text));
  if(allowance)text=text.split(/\r?\n/).map(line=>allowance.lines.includes(line)?'':line).join('\n');
  if(parseMap&&file.endsWith('.map')){
    const inspect=value=>typeof value==='string'?violations(file,value,false):Array.isArray(value)?value.flatMap(inspect):value&&typeof value==='object'?Object.entries(value).flatMap(([key,entry])=>[...inspect(key),...inspect(entry)]):[];
    return inspect(JSON.parse(text));
  }
  const found=text.split(/\r?\n/).flatMap((line,index)=>[...line.matchAll(stale)].map(()=>`${file}:${index+1}: current guidance must use the verified SDK pin`));
  // Lockfile installed versions are separate from the manifest's admissible peer range.
  if(file.endsWith('package-lock.json')){
    const lock=JSON.parse(text);
    for(const [location,entry] of Object.entries(lock.packages??{}))if(location.endsWith('node_modules/@arkiv-network/sdk')&&entry.version===[1,0,0].join('.'))found.push(`${file}: stale installed SDK lock entry`);
  }
  return found;
}
export function checkTree(root){
  const findings=[];
  function visit(dir,prefix=''){
    for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
      if(ignored.has(entry.name)||entry.name.endsWith('.tsbuildinfo'))continue;
      const relative=prefix+entry.name,absolute=path.join(dir,entry.name);
      if(entry.isSymbolicLink())throw Error(`Unexpected symlink: ${relative}`);
      if(entry.isDirectory()){visit(absolute,relative+'/');continue;}
      const data=fs.readFileSync(absolute);if(data.includes(0))continue;
      let text;try{text=new TextDecoder('utf8',{fatal:true}).decode(data);}catch{continue;}
      findings.push(...violations(relative,text));
    }
  }
  visit(root);return findings;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const findings=checkTree(path.resolve(process.argv[2]??'.'));
  if(findings.length){console.error(findings.join('\n'));process.exitCode=1;}else console.log('PASS current SDK guidance, locks and generated strings');
}
