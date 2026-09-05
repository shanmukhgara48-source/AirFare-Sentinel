import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import ts from 'typescript'
// Compile the pure helpers with an inert URL adapter; no network or app state.
const code=ts.transpileModule(await fs.readFile(new URL('./src/components/route-map/data.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/import airportCatalog from '.\/airports.json';/, 'const airportCatalog = {};').replace(/import .* from '..\/..\/api';/, 'const apiUrl = x => x; const qs = () => "";')
const {summarizeExport,parseCsv,arc,ROUTES,pressure,COLORS}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
const header='source_type,provider,total_fare,quote_date\r\n'
assert.deepEqual(summarizeExport(header+'live,ignav,10000,2026-09-01\r\nlive,ignav,12000,2026-09-01\r\nlive,amadeus,15000,2026-09-02','live'),{series:[{date:'2026-09-01',value:11000},{date:'2026-09-02',value:15000}],providers:['ignav','amadeus'],count:3})
assert.throws(()=>summarizeExport(header+'demo,,9999,2026-09-01','live'),/Analysis source changed/)
assert.throws(()=>summarizeExport('{}','live'),/malformed/)
assert.throws(()=>parseCsv('"unterminated'),/malformed/)
assert.deepEqual(parseCsv('a,b\r\n"x,y","hello ""world"""'),[['a','b'],['x,y','hello "world"']])
assert.equal(summarizeExport(header+'live,ignav,,2026-09-01\nlive,ignav,0,2026-09-01\nlive,ignav,NaN,2026-09-01','live').count,0)
assert.equal(summarizeExport(header,'imported').count,0)
assert.equal(new Set(ROUTES.map(route=>arc(route).path)).size,14)
assert.equal(pressure({route:'DEL-BOM',alerts:null}).color,COLORS.missing)
assert.equal(pressure({route:'DEL-BOM',quote:{change_pct:null},alerts:[]}).color,COLORS.missing)
console.log('PASS: CSV parsing, actual provider provenance, source-mixing rejection, malformed/missing prices, empty rows, directional geometry and unavailable states')

const majorCode=ts.transpileModule(await fs.readFile(new URL('./src/components/route-map/majorRoutes.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
const {selectMajorRoutes,MAJOR_ROUTE_LIMIT}=await import(`data:text/javascript;base64,${Buffer.from(majorCode).toString('base64')}`)
assert.deepEqual(selectMajorRoutes(['DEL-BOM','BOM-DEL','DEL-REW']),['BOM-DEL','DEL-BOM'])
assert.deepEqual(selectMajorRoutes(['CCU-GAU']),['CCU-GAU'],'Missing reverse fares are not invented')
assert.deepEqual(selectMajorRoutes(['DEL-BOM','BOM-DEL'],1),[],'The limit never splits an observed pair')
assert.deepEqual(selectMajorRoutes(['DEL-REW']),[],'Regional connections do not silently fill the major shortlist')
assert.equal(selectMajorRoutes([...ROUTES,...ROUTES]).length,14,'Demo basket retained and duplicates excluded')
assert.ok(selectMajorRoutes(ROUTES).length<=MAJOR_ROUTE_LIMIT)
const hubs=['DEL','BOM','BLR','CCU','HYD','MAA','PNQ','AMD','COK','GAU','GOI','GOX']
const denseNetwork=hubs.flatMap(origin=>hubs.filter(destination=>destination!==origin).map(destination=>`${origin}-${destination}`))
const capped=selectMajorRoutes(denseNetwork)
assert.equal(capped.length,30,'A dense network respects the actual 30-direction boundary')
assert.ok(capped.every(route=>capped.includes(route.split('-').reverse().join('-'))))
console.log('PASS: major corridor selection, available-data intersection, direction pairing, deduplication and map limit')
