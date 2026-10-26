// C++17 원본 컴파일/결과와 탐침 사본의 실제 의미 이벤트 순서를 검증한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXAMPLES, buildBundle, buildSteps } from '../../scripts/trace-builders.mjs';
import { LANGUAGE_ORDER, LANGUAGE_IDS } from '../../frontend/js/trace-contract.js';
import { createPlayerState, reducePlayer, selectView, ACTIONS } from '../../frontend/js/player-state.js';
const run = (cmd,args,opts={}) => spawnSync(cmd,args,{encoding:'utf8',timeout:30000,windowsHide:true,...opts});
const compiler = process.env.CXX || 'g++';
const available = run(compiler,['--version']).status === 0;
// 빌더와 별개로 검토한 소스 문장 표. 줄 번호 이동/다른 연산 강조를 잡는다.
const SOURCE = {
 bfs: {initial:[], 'mark-start':['std::vector<bool> visited(graph.size(), false);','visited[start] = true;'], 'enqueue-start':['std::queue<int> queue;','queue.push(start);'], 'dequeue-node':['while (!queue.empty()) {','int node = queue.front();','queue.pop();'], 'check-neighbor':['for (int nxt : graph[node]) {','if (!visited[nxt]) {'], 'mark-neighbor':['visited[nxt] = true;'], 'enqueue-neighbor':['queue.push(nxt);'], 'process-node':['for (int nxt : graph[node]) {'], finish:['while (!queue.empty()) {']},
 dfs: {initial:[], 'call-start':['void dfs(const std::vector<std::vector<int>>& graph, int node, std::vector<bool>& visited) {'], 'call-neighbor':['void dfs(const std::vector<std::vector<int>>& graph, int node, std::vector<bool>& visited) {','dfs(graph, nxt, visited);'], discover:['visited[node] = true;'], 'check-neighbor':['for (int nxt : graph[node]) {','if (!visited[nxt]) {'],process:['for (int nxt : graph[node]) {'],'return-start':['void dfs(const std::vector<std::vector<int>>& graph, int node, std::vector<bool>& visited) {'],'return-neighbor':['dfs(graph, nxt, visited);']},
 'binary-search': {initial:[], 'first-mid':['int left = 0, right = static_cast<int>(values.size()) - 1;','while (left <= right) {','int mid = left + (right - left) / 2;'],'compute-mid':['while (left <= right) {','int mid = left + (right - left) / 2;'],'compare-equal':['if (values[mid] == target) {'],'compare-smaller':['if (values[mid] == target) {','} else if (values[mid] < target) {'],'compare-larger':['if (values[mid] == target) {','} else if (values[mid] < target) {'],found:['return mid;'],'set-left':['left = mid + 1;'],'set-right':['right = mid - 1;'],'first-finish':['int left = 0, right = static_cast<int>(values.size()) - 1;','while (left <= right) {','return -1;'],finish:['while (left <= right) {','return -1;']},
 'bubble-sort': {initial:[],'first-compare':['int n = static_cast<int>(values.size());','for (int i = 0; i < n - 1; i++) {','for (int j = 0; j < n - 1 - i; j++) {','if (values[j] > values[j + 1]) {'],'pass-compare':['for (int i = 0; i < n - 1; i++) {','for (int j = 0; j < n - 1 - i; j++) {','if (values[j] > values[j + 1]) {'],compare:['for (int j = 0; j < n - 1 - i; j++) {','if (values[j] > values[j + 1]) {'],swap:['std::swap(values[j], values[j + 1]);'],'mark-sorted':['for (int j = 0; j < n - 1 - i; j++) {'],finish:['for (int i = 0; i < n - 1; i++) {'],'finish-empty':['int n = static_cast<int>(values.size());','for (int i = 0; i < n - 1; i++) {']}
};
test('언어 우선순위와 C++ 전환: 모든 예제의 모든 단계에서 상태 유지·매핑 의미 일치',()=>{
 assert.deepEqual(LANGUAGE_ORDER,['python','cpp','java','kotlin','rust','c','javascript']);
 assert.deepEqual(LANGUAGE_IDS,['python','cpp','java','kotlin','rust','c','javascript']);
 for(const ex of EXAMPLES){const b=buildBundle(ex);assert.deepEqual(Object.keys(b.codes),LANGUAGE_IDS);
  for(const step of b.steps){assert.deepEqual(step.lines.cpp.map(n=>b.codes.cpp.lines[n-1].trim()),SOURCE[ex.algorithmId][step.eventId]);
   const s=reducePlayer(createPlayerState(b,'python'),{type:ACTIONS.SEEK,index:step.index});
   const switched=reducePlayer(s,{type:ACTIONS.SWITCH_LANGUAGE,languageId:'cpp'});
   assert.equal(switched.stepIndex,step.index); assert.equal(selectView(b,switched).step,selectView(b,s).step);
   assert.equal(selectView(b,switched).notes,b.codes.cpp.notes);
  }
 }
 const reversed=buildBundle(EXAMPLES[0]);reversed.codes=Object.fromEntries(Object.entries(reversed.codes).reverse());
 assert.deepEqual(createPlayerState(reversed,'python').languages,LANGUAGE_IDS);
});
const emit = id => 'emit("'+id+'");';
function instrument(id,lines){return lines.map((line,i)=>{
 let before='',after='';const n=i+1;
 if(id==='bfs'){
  if(n===5)after=emit('mark-start');if(n===7)after=emit('enqueue-start');if(n===10)after=emit('dequeue-node');
  if(n===11)after=emit('check-neighbor');if(n===13)after=emit('mark-neighbor');if(n===14)after=emit('enqueue-neighbor');
  if(n===16)after=emit('process-node');if(n===17)after=emit('finish');
 }else if(id==='dfs'){
  if(n===2)after='emit(depth++ == 0 ? "call-start" : "call-neighbor");';if(n===3)after=emit('discover');
  if(n===4)after=emit('check-neighbor');if(n===8)after=emit('process');if(n===9)before='emit(--depth == 0 ? "return-start" : "return-neighbor");';
 }else if(id==='binary-search'){
  if(n===3)after='bool first = true;';if(n===5)after='emit(first ? "first-mid" : "compute-mid"); first=false; emit(values[mid]==target ? "compare-equal" : values[mid]<target ? "compare-smaller" : "compare-larger");';
  if(n===7)before=emit('found');if(n===9)after=emit('set-left');if(n===11)after=emit('set-right');if(n===14)before='emit(first ? "first-finish" : "finish");';
 }else{
  if(n===6)after='emit(i==0 && j==0 ? "first-compare" : j==0 ? "pass-compare" : "compare");';if(n===8)after=emit('swap');
  if(n===10)after=emit('mark-sorted');if(n===11)after='emit(n<=1 ? "finish-empty" : "finish");';
 }
 return before+'\n'+line+'\n'+after;
}).join('\n');}
function driver(id){return id==='bfs'||id==='dfs' ? String.raw`
int main(){int n,start;std::cin>>n>>start;std::vector<std::vector<int>> graph(n);for(auto& row:graph){int k;std::cin>>k;while(k--){int v;std::cin>>v;row.push_back(v);}}
`+(id==='bfs'?'bfs(graph,start);':'std::vector<bool> visited(n,false);dfs(graph,start,visited);')+'}\n' : String.raw`
int main(){int n,target;std::cin>>n>>target;std::vector<int> values(n);for(int& v:values)std::cin>>v;
`+(id==='binary-search'?'std::cout<<binary_search(values,target);':'bubble_sort(values);for(int v:values)std::cout<<v<<" ";')+'}\n';}
function stdin(input){if(input.graph){const nodes=Object.keys(input.graph);return [nodes.length,nodes.indexOf(input.start),...nodes.flatMap(n=>[input.graph[n].length,...input.graph[n].map(v=>nodes.indexOf(v))])].join(' ');}
 return [input.values.length,input.target??0,...input.values].join(' ');}
for(const id of Object.keys(SOURCE))test('C++17 '+id+': 원본 경고 없이 컴파일·실행, 탐침 사본 이벤트가 trace와 일치',{skip:!available?'실행하지 않음: g++ C++17 컴파일러를 찾지 못했습니다.':false},()=>{
 const dir=mkdtempSync(join(tmpdir(),'cpp-trace-'));
 try{
  const lines=JSON.parse(readFileSync(new URL('../../frontend/js/data/'+EXAMPLES.find(e=>e.algorithmId===id).algorithmId+'/'+EXAMPLES.find(e=>e.algorithmId===id).id+'.json',import.meta.url),'utf8')).codes.cpp.lines;
  const header='#include <iostream>\nint depth=0;\nvoid emit(const char* e){std::cerr<<e<<"\\n";}\n';
  for(const traced of [false,true]){
   const file=join(dir,traced?'traced.cpp':'original.cpp'),exe=join(dir,traced?'traced.exe':'original.exe');
   writeFileSync(file,header+(traced?instrument(id,lines):lines.join('\n'))+driver(id));
   const compiled=run(compiler,['-std=c++17','-Wall','-Wextra','-Werror',file,'-o',exe]);assert.equal(compiled.status,0,compiled.stderr);
   const inputs=EXAMPLES.filter(e=>e.algorithmId===id).map(e=>e.input);
   if(id==='bfs'||id==='dfs')inputs.push({graph:{A:['A','C','B'],B:[],C:['A','B'],X:[]},start:'A'},{graph:{A:[]},start:'A'});
   else inputs.push({values:[],target:-1},{values:[-3,-1,0,2,9],target:10},{values:[3,3,-1,-1],target:3});
   for(const input of inputs){if(id==='binary-search')input.values=[...input.values].sort((a,b)=>a-b);
    const result=run(exe,[],{input:stdin(input)});assert.equal(result.status,0,result.stderr);
    if(traced)assert.deepEqual(result.stderr.trim().split(/\r?\n/),buildSteps(id,input).slice(1).map(s=>s.eventId));
    if(id==='binary-search'){const index=Number(result.stdout);assert.ok(index===-1?!input.values.includes(input.target):input.values[index]===input.target);}
    if(id==='bubble-sort')assert.deepEqual(result.stdout.trim()?result.stdout.trim().split(/\s+/).map(Number):[],[...input.values].sort((a,b)=>a-b));
   }
  }
 }finally{rmSync(dir,{recursive:true,force:true});}
});
