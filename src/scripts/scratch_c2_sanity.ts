/** C2 sanity: is the monotone pattern explained by the head's own IC on this window? */
import 'dotenv/config';
const mean=(a:number[])=>a.reduce((x,y)=>x+y,0)/(a.length||1);
function spearman(a:number[],b:number[]){
  const rk=(xs:number[])=>{const idx=xs.map((v,i)=>[v,i] as const).sort((p,q)=>p[0]-q[0]);const r=new Array(xs.length).fill(0);
    for(let i=0;i<idx.length;){let j=i;while(j+1<idx.length&&idx[j+1][0]===idx[i][0])j++;const av=(i+j)/2+1;
    for(let k=i;k<=j;k++)r[idx[k][1]]=av;i=j+1;}return r;};
  const ra=rk(a),rb=rk(b),ma=mean(ra),mb=mean(rb);let n=0,da=0,db=0;
  for(let i=0;i<ra.length;i++){n+=(ra[i]-ma)*(rb[i]-mb);da+=(ra[i]-ma)**2;db+=(rb[i]-mb)**2;}
  return da&&db?n/Math.sqrt(da*db):0;
}
function tStat(d:number[]){if(d.length<2)return NaN;const m=mean(d);
  const sd=Math.sqrt(d.reduce((a,b)=>a+(b-m)**2,0)/(d.length-1));return sd>0?m/(sd/Math.sqrt(d.length)):NaN;}
async function main(){
  const { supabase } = await import('../db/supabaseClient');
  const rows:any[]=[];
  for(let f=0;;f+=1000){
    const {data,error}=await supabase.from('outcome_results')
      .select('symbol, run_date, predicted_return, actual_return')
      .eq('horizon','2W').gte('run_date','2026-08-09').range(f,f+999);
    if(error)throw error; rows.push(...(data??[])); if((data??[]).length<1000)break;
  }
  const use=rows.filter(r=>r.predicted_return!=null&&r.actual_return!=null);
  const byDay=new Map<string,any[]>();
  for(const r of use){const d=String(r.run_date).slice(0,10);if(!byDay.has(d))byDay.set(d,[]);byDay.get(d)!.push(r);}
  const ics:number[]=[]; const days=[...byDay.keys()].sort();
  for(const d of days){
    const g=byDay.get(d)!; if(g.length<5)continue;
    const p=g.map(r=>Number(r.predicted_return)), y=g.map(r=>Number(r.actual_return));
    if(new Set(y).size<2)continue;
    ics.push(spearman(p,y));
  }
  console.log(`D5 2W post-parity, matured, day-clustered IC`);
  console.log(`  days ${ics.length}   mean IC ${mean(ics).toFixed(4)}   t=${tStat(ics).toFixed(2)}`);
  console.log(`  positive days ${ics.filter(x=>x>0).length}/${ics.length}`);
  console.log(`  vs v9.4 TEST_IC_DAILY anchor for 2W: +0.1111`);
  console.log(`\n  (A negative or ~zero IC is what makes "select harder -> do worse" coherent.`);
  console.log(`   A clearly POSITIVE IC alongside C2's monotone decline would be a contradiction`);
  console.log(`   needing explanation, not a result.)`);
  process.exit(0);
}
main().catch(e=>{console.error(e.message);process.exit(1);});
