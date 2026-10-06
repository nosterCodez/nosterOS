// Original synthetic fixture, no downloaded places data. Minimal required-column PLAIN Parquet encoder.
const fs = require('node:fs');
const path = require('node:path');
const v = n => { let x=BigInt(n), b=[]; do { const y=Number(x&127n); x>>=7n; b.push(y|(x?128:0)); } while(x); return Buffer.from(b); };
const i = n => v(BigInt(n)*2n);
const str = s => { const b=Buffer.from(s); return Buffer.concat([v(b.length),b]); };
const list = (type, values) => Buffer.concat([values.length<15?Buffer.from([(values.length<<4)|type]):Buffer.concat([Buffer.from([240|type]),v(values.length)]),...values]);
const struct = fields => { let last=0; return Buffer.concat([...fields.map(([id,type,value])=>{const header=Buffer.from([((id-last)<<4)|type]);last=id;return Buffer.concat([header,value]);}),Buffer.from([0])]); };
const rows = [
 { fsq_place_id:'fixture-inside',name:'Fixture salon',latitude:26.215,longitude:-98.325,locality:'Mission',address:'123 Test Street',website:'https://example.test',tel:'555-0100' },
 { fsq_place_id:'fixture-outside',name:'Outside fixture',latitude:30,longitude:-100,locality:'Elsewhere',address:'456 Test Street',website:'https://outside.test',tel:'' },
];
const names=Object.keys(rows[0]), chunks=[Buffer.from('PAR1')], columns=[], schema=[struct([[4,8,str('schema')],[5,5,i(names.length)]])]; let offset=4;
for(const name of names){
 const numeric=typeof rows[0][name]==='number', type=numeric?5:6;
 schema.push(struct([[1,5,i(type)],[3,5,i(0)],[4,8,str(name)],...(!numeric?[[6,5,i(0)]]:[])]));
 const data=Buffer.concat(rows.map(row=>{if(numeric){const b=Buffer.alloc(8);b.writeDoubleLE(row[name]);return b;}const s=Buffer.from(row[name]),b=Buffer.alloc(4);b.writeUInt32LE(s.length);return Buffer.concat([b,s]);}));
 const page=struct([[1,5,i(0)],[2,5,i(data.length)],[3,5,i(data.length)],[5,12,struct([[1,5,i(rows.length)],[2,5,i(0)],[3,5,i(3)],[4,5,i(3)]])]]);
 const bytes=Buffer.concat([page,data]);
 const meta=struct([[1,5,i(type)],[2,9,list(5,[i(0),i(3)])],[3,9,list(8,[str(name)])],[4,5,i(0)],[5,6,i(rows.length)],[6,6,i(bytes.length)],[7,6,i(bytes.length)],[9,6,i(offset)]]);
 columns.push(struct([[2,6,i(offset)],[3,12,meta]]));chunks.push(bytes);offset+=bytes.length;
}
const group=struct([[1,9,list(12,columns)],[2,6,i(offset-4)],[3,6,i(rows.length)]]);
const metadata=struct([[1,5,i(1)],[2,9,list(12,schema)],[3,6,i(rows.length)],[4,9,list(12,[group])],[6,8,str('OmegaOS synthetic test fixture')]]);
const length=Buffer.alloc(4);length.writeUInt32LE(metadata.length);
fs.writeFileSync(path.join(__dirname,'places.parquet'),Buffer.concat([...chunks,metadata,length,Buffer.from('PAR1')]));
