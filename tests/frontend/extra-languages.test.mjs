import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXAMPLES, buildBundle, buildSteps } from '../../scripts/trace-builders.mjs';
import { createPlayerState, reducePlayer, selectView, ACTIONS } from '../../frontend/js/player-state.js';
const run=(cmd,args,opts={})=>spawnSync(cmd,args,{encoding:'utf8',timeout:30000,windowsHide:true,...opts});
const runJava=(args,input)=>new Promise((resolve,reject)=>{const p=spawn('java',args,{windowsHide:true});let stdout='',stderr='';const timer=setTimeout(()=>{p.kill();reject(new Error('Java 실행 시간 초과'));},30000);p.stdout.on('data',d=>stdout+=d);p.stderr.on('data',d=>stderr+=d);p.on('error',reject);p.on('close',status=>{clearTimeout(timer);resolve({status,stdout,stderr});});p.stdin.end(input);});
const languages=['java','kotlin','rust'];
test('일곱 언어의 모든 등록 단계에서 언어 전환이 단계·상태·강조·설명을 유지한다',()=>{
 for(const ex of EXAMPLES){const b=buildBundle(ex);for(const step of b.steps){
  const state=reducePlayer(createPlayerState(b,'python'),{type:ACTIONS.SEEK,index:step.index});
  for(const languageId of languages){const switched=reducePlayer(state,{type:ACTIONS.SWITCH_LANGUAGE,languageId});const view=selectView(b,switched);
   assert.equal(switched.languageId,languageId);assert.equal(switched.stepIndex,step.index);assert.equal(view.step,step);assert.equal(view.notes,b.codes[languageId].notes);
   assert.ok(step.lines[languageId].every(n=>n>0 && n<=b.codes[languageId].lines.length));
  }
 }}
});
function cases(id){const inputs=EXAMPLES.filter(e=>e.algorithmId===id).map(e=>e.input);
 if(id==='bfs'||id==='dfs')inputs.push({graph:{A:['A','C','B'],B:[],C:['A','B'],X:[]},start:'A'},{graph:{A:[]},start:'A'});
 else inputs.push({values:[],target:3},{values:[-3,-1,0,2,9],target:10},{values:[-1,-1,3,3],target:3});
 return inputs;
}
function stdin(input){if(input.graph){const nodes=Object.keys(input.graph);return [nodes.length,nodes.indexOf(input.start),...nodes.flatMap(n=>[input.graph[n].length,...input.graph[n].map(v=>nodes.indexOf(v))])].join(' ');}return [input.values.length,input.target??0,...input.values].join(' ');}
function instrumentJava(id,lines){const emit=id=>'System.err.println("'+id+'");';return lines.map((line,i)=>{const n=i+1;let before='',after='';
 if(id==='bfs'){if(n===5)after=emit('mark-start');if(n===7)after=emit('enqueue-start');if(n===9)after=emit('dequeue-node');if(n===10)after=emit('check-neighbor');if(n===12)after=emit('mark-neighbor');if(n===13)after=emit('enqueue-neighbor');if(n===15)after=emit('process-node');if(n===16)after=emit('finish');}
 if(id==='dfs'){if(n===1)after='static int depth=0;';if(n===2)after='System.err.println(depth++==0 ? "call-start" : "call-neighbor");';if(n===3)after=emit('discover');if(n===4)after=emit('check-neighbor');if(n===8)after=emit('process');if(n===9)before='System.err.println(--depth==0 ? "return-start" : "return-neighbor");';}
 if(id==='binary-search'){if(n===3)after='boolean first=true;';if(n===5)after='System.err.println(first ? "first-mid" : "compute-mid");first=false;System.err.println(values[mid]==target ? "compare-equal" : values[mid]<target ? "compare-smaller" : "compare-larger");';if(n===7)before=emit('found');if(n===9)after=emit('set-left');if(n===11)after=emit('set-right');if(n===14)before='System.err.println(first ? "first-finish" : "finish");';}
 if(id==='bubble-sort'){if(n===5)after='System.err.println(i==0 && j==0 ? "first-compare" : j==0 ? "pass-compare" : "compare");';if(n===9)after=emit('swap');if(n===11)after=emit('mark-sorted');if(n===12)after='System.err.println(n<=1 ? "finish-empty" : "finish");';}
 return before+'\n'+line+'\n'+after;}).join('\n');}
function javaDriver(id){return 'class Main { public static void main(String[] args) { java.util.Scanner s=new java.util.Scanner(System.in);int n=s.nextInt(),t=s.nextInt();'+
 (id==='bfs'||id==='dfs'?'int[][] graph=new int[n][];for(int i=0;i<n;i++){graph[i]=new int[s.nextInt()];for(int j=0;j<graph[i].length;j++)graph[i][j]=s.nextInt();}'+(id==='bfs'?'Algorithm.bfs(graph,t);':'Algorithm.dfs(graph,t,new boolean[n]);'):
 'int[] values=new int[n];for(int i=0;i<n;i++)values[i]=s.nextInt();'+(id==='binary-search'?'System.out.print(Algorithm.binarySearch(values,t));':'Algorithm.bubbleSort(values);for(int v:values)System.out.print(v+" ");'))+'}}';}
for(const id of ['bfs','dfs','binary-search','bubble-sort'])test('Java '+id+': 원본 컴파일·실행 및 탐침 이벤트 순서 검증',{skip:run('java',['--version']).status!==0?'Java 11 이상 실행기를 찾지 못함':false},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'java-trace-'));
 try{const lines=buildBundle(EXAMPLES.find(e=>e.algorithmId===id)).codes.java.lines;
 for(const traced of [false,true]){const source=traced?instrumentJava(id,lines):lines.join('\n');
 const imports=source.split('\n').filter(line=>line.startsWith('import ')).join('\n');
 const body=source.split('\n').filter(line=>!line.startsWith('import ')).join('\n');
 writeFileSync(join(dir,'Main.java'),imports+'\n'+javaDriver(id)+'\n'+body);
 for(const input of cases(id)){const actual=await runJava(['-Dfile.encoding=UTF-8',join(dir,'Main.java')],stdin(input)+'\n');assert.equal(actual.status,0,actual.stderr);
 if(traced)assert.deepEqual(actual.stderr.trim().split(/\r?\n/),buildSteps(id,input).slice(1).map(s=>s.eventId));
 if(id==='binary-search'){const index=Number(actual.stdout);assert.ok(index===-1?!input.values.includes(input.target):input.values[index]===input.target);}
 if(id==='bubble-sort')assert.deepEqual(actual.stdout.trim()?actual.stdout.trim().split(/\s+/).map(Number):[],[...input.values].sort((a,b)=>a-b));
 }
 }}finally{rmSync(dir,{recursive:true,force:true});}
});

// 실행기가 없는 환경에서는 미실행 사유를 표시한다. 콘텐츠·전환 검증과 실행 검증을 구분한다.
for(const language of ['kotlin','rust'])for(const id of ['bfs','dfs','binary-search','bubble-sort'])test(language+' '+id+': 원본 컴파일 및 경계 입력 결과',{skip:run(language==='rust'?'rustc':'kotlinc',['-version']).status!==0 && run(language==='rust'?'rustc':'kotlinc',['--version']).status!==0 ? language+' 컴파일러를 찾지 못함':false},()=>{
 const dir=mkdtempSync(join(tmpdir(),'language-trace-'));
 try{const code=buildBundle(EXAMPLES.find(e=>e.algorithmId===id)).codes[language].lines.join('\n');
 const graph=id==='bfs'||id==='dfs';
 if(language==='rust'){
  const driver='use std::io::Read;\nfn main(){let mut text=String::new();std::io::stdin().read_to_string(&mut text).unwrap();let mut it=text.split_whitespace();let n:usize=it.next().unwrap().parse().unwrap();'+
   (graph?'let t:usize=it.next().unwrap().parse().unwrap();let mut graph=vec![Vec::new();n];for row in &mut graph {let k:usize=it.next().unwrap().parse().unwrap();for _ in 0..k {row.push(it.next().unwrap().parse().unwrap());}}'+(id==='bfs'?'bfs(&graph,t);':'dfs(&graph,t,&mut vec![false;n]);'):
   'let target:i32=it.next().unwrap().parse().unwrap();let mut values:Vec<i32>=(0..n).map(|_|it.next().unwrap().parse().unwrap()).collect();'+(id==='binary-search'?'println!("{}",binary_search(&values,target));':'let _=target;bubble_sort(&mut values);for v in values {print!("{} ",v);}'))+'}';
  writeFileSync(join(dir,'main.rs'),code+'\n'+driver);const c=run('rustc',['--edition=2021',join(dir,'main.rs'),'-o',join(dir,'main.exe')]);assert.equal(c.status,0,c.stderr);
 }else{
  const driver='fun main() { val tokens=readLine()!!.trim().split(Regex("\\s+"));var pos=0;fun next(): Int = tokens[pos++].toInt();val n=next();val target=next();'+
   (graph?'val graph=Array(n){IntArray(next()){next()}};'+(id==='bfs'?'bfs(graph,target)':'dfs(graph,target,BooleanArray(n))'):
   'val values=IntArray(n){next()};'+(id==='binary-search'?'print(binarySearch(values,target))':'bubbleSort(values);print(values.joinToString(" "))'))+'}';
  writeFileSync(join(dir,'Main.kt'),code+'\n'+driver);const c=run('kotlinc',[join(dir,'Main.kt'),'-include-runtime','-d',join(dir,'main.jar')]);assert.equal(c.status,0,c.stderr);
 }
 for(const input of cases(id)){const actual=language==='rust'?run(join(dir,'main.exe'),[],{input:stdin(input)+'\n'}):run('java',['-jar',join(dir,'main.jar')],{input:stdin(input)+'\n'});assert.equal(actual.status,0,actual.stderr);
  if(id==='binary-search'){const index=Number(actual.stdout);assert.ok(index===-1?!input.values.includes(input.target):input.values[index]===input.target);}
  if(id==='bubble-sort')assert.deepEqual(actual.stdout.trim()?actual.stdout.trim().split(/\s+/).map(Number):[],[...input.values].sort((a,b)=>a-b));
 }
 }finally{rmSync(dir,{recursive:true,force:true});}
});
