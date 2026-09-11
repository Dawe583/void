/** Core-only regression runner: no GUI, TUI, provider, production credentials or deployment. */
import { readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
const root = resolve(import.meta.dirname, '../..');
const packages = ['ledger', 'policy', 'registry', 'proxy', 'connectors', 'cli', 'sdk', 'workbench'];
let failed=false,total=0;
for(const name of packages){
 const dir=join(root,'packages',name),files=readdirSync(join(dir,'src'),{recursive:true}).filter(file=>/\.test\.(ts|mjs)$/.test(file)&&!/(^|\/)(tui|gui|provider)(\/|[.-])/.test(file)).map(file=>join(dir,'src',file));
 if(!files.length)throw new Error(`No core tests in ${name}.`);
 const run=spawnSync(process.execPath,['--test','--test-reporter=tap',...files],{cwd:dir,encoding:'utf8',maxBuffer:32*1024*1024});
 const output=(run.stdout??'')+(run.stderr??''),passes=Number(output.match(/^# pass (\d+)$/m)?.[1]??0),failures=Number(output.match(/^# fail (\d+)$/m)?.[1]??0);total+=passes;
 console.log(`${name}: ${passes} pass, ${failures} fail (${files.length} files).`);
 if(run.status!==0||!passes){failed=true;console.log(output);}
}
console.log(`Core-only total: ${total} passing tests. No GUI/TUI suites.`);process.exitCode=failed?1:0;
