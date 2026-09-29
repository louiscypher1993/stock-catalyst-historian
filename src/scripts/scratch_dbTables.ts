/** Enumerate EVERY table PostgREST exposes, with row counts. READ-ONLY. */
import 'dotenv/config';
async function main(){
  const url = process.env.SUPABASE_URL!, key = process.env.SUPABASE_ANON_KEY!;
  const r = await fetch(`${url}/rest/v1/`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!r.ok) { console.error(`root fetch ${r.status}`); process.exit(1); }
  const spec: any = await r.json();
  const names = Object.keys(spec.definitions ?? spec.components?.schemas ?? {});
  console.log(`PostgREST exposes ${names.length} tables/views\n`);
  const { supabase } = await import('../db/supabaseClient');
  const out: Array<{t:string;n:number|null}> = [];
  for (const t of names) {
    const { count, error } = await supabase.from(t).select('*',{count:'exact',head:true});
    out.push({ t, n: error ? null : (count ?? 0) });
  }
  out.sort((a,b)=>(b.n ?? -1)-(a.n ?? -1));
  for (const o of out) console.log(`  ${o.t.padEnd(38)} ${o.n === null ? 'n/a' : String(o.n).padStart(8)}`);
  console.log(`\n  TOTAL ROWS: ${out.reduce((s,o)=>s+(o.n ?? 0),0)}`);
  process.exit(0);
}
main().catch(e=>{console.error(e.message);process.exit(1);});
