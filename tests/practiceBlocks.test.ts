import { describe, expect, it } from 'vitest';
import { mergePracticeBlocks, resolvePracticeBlocksWithIssues, savePracticeBlock, splitPracticeBlock } from '../lib/practiceBlocks';

const matches = [
  { id:'m1',date:'2026-10-14T21:30:00Z' }, // 15 Oct Cairo
  { id:'m2',date:'2026-10-15' },
  { id:'m3',date:'2026-10-15T22:30:00Z' }, // 16 Oct Cairo
  { id:'bad',date:'2026-10-15T10:00:00' },
] as any[];
const block = (id:string, matchIds:string[]) => ({ schema:'moetracker.practice-block/v1',id,name:id,matchIds,createdAt:'2026-10-15T00:00:00Z',createdBy:'coach',updatedAt:'2026-10-15T00:00:00Z',updatedBy:'coach' });

describe('S1.1 practice blocks', () => {
  it('groups fallbacks by Cairo date and leaves malformed no-offset timestamps unassigned', () => {
    const result=resolvePracticeBlocksWithIssues(matches,[]);
    expect(result.blocks.map(item=>[item.id,item.matchIds])).toEqual([['cairo-date:2026-10-16',['m3']],['cairo-date:2026-10-15',['m1','m2']]]);
    expect(result.unassignedMatchIds).toEqual(['bad']);
  });
  it('lets the first explicit assignment win and reports imported overlap/unknown IDs', () => {
    const result=resolvePracticeBlocksWithIssues(matches,[block('a',['m1','gone']),block('b',['m1','m2'])] as any);
    expect(result.blocks.find(item=>item.id==='a')?.matchIds).toEqual(['m1']); expect(result.blocks.find(item=>item.id==='b')?.matchIds).toEqual(['m2']);
    expect(result.issues).toEqual(expect.arrayContaining([{code:'unknown-match',id:'gone'},{code:'overlap',id:'m1'}]));
  });
  it('rejects unknown IDs atomically', () => {
    const db:any={matches,practiceBlocks:[block('00000000-0000-4000-8000-000000000001',['m1'])]}; const before=structuredClone(db);
    expect(()=>savePracticeBlock(db,{name:'Nope',matchIds:['m2','missing']},'coach')).toThrow('unknown match'); expect(db).toEqual(before);
    expect(()=>splitPracticeBlock(db,{id:db.practiceBlocks[0].id,name:'Split',matchIds:['m2']},'coach')).toThrow('outside'); expect(db).toEqual(before);
  });
  it('renames/reassigns idempotently and keeps a stable ID across merge', () => {
    const first='00000000-0000-4000-8000-000000000001'; const second='00000000-0000-4000-8000-000000000002'; const db:any={matches,practiceBlocks:[block(first,['m1']),block(second,['m2'])]};
    const renamed=savePracticeBlock(db,{id:first,name:'Night block',matchIds:['m1']},'coach','2026-10-15T01:00:00Z'); expect(renamed.id).toBe(first);
    const merged=mergePracticeBlocks(db,{ids:[first,second],name:'Combined'},'coach','2026-10-15T02:00:00Z'); expect(merged.id).toBe(first); expect(merged.matchIds).toEqual(['m1','m2']);
  });
  it('rolls back split and merge when malformed imported state fails final validation',()=>{
    const first='00000000-0000-4000-8000-000000000001', second='00000000-0000-4000-8000-000000000002';
    const splitDb:any={matches,practiceBlocks:[block(first,['m1','m2']),block(second,['m2'])]}; const splitBefore=structuredClone(splitDb);
    expect(()=>splitPracticeBlock(splitDb,{id:first,name:'Split',matchIds:['m2']},'coach')).toThrow('only one'); expect(splitDb).toEqual(splitBefore);
    const mergeDb:any={matches,practiceBlocks:[block(first,['m1','missing']),block(second,['m2'])]}; const mergeBefore=structuredClone(mergeDb);
    expect(()=>mergePracticeBlocks(mergeDb,{ids:[first,second],name:'Merged'},'coach')).toThrow('unknown match'); expect(mergeDb).toEqual(mergeBefore);
  });
});
