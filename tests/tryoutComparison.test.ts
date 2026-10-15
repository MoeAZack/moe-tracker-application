import { describe, expect, it } from 'vitest';
import { buildCoverageGatedRanks, buildEvaluationExport, buildTryoutComparison, comparisonParticipants } from '../lib/tryoutComparison';
import { buildShareableBackupPayload, toPublicTrackerData, toWebsiteTrackerData } from '../lib/publicData';
import { createPortablePackage } from '../lib/portablePackage';
import { saveMatchSchema } from '../schemas';
import { addCoreMembership, addTryoutCandidate, archiveAndResetSeason, promoteTryoutCandidate, restoreSeasonArchive } from '../lib/roster';

const p1='00000000-0000-4000-8000-000000000001', p2='00000000-0000-4000-8000-000000000002', p3='00000000-0000-4000-8000-000000000003';
const source={method:'manual' as const,capturedAt:'2026-10-15T10:00:00Z'};
const match=(id:string,map='Ascent',ours:number|null=13,theirs:number|null=8)=>({id,date:'2026-10-15',type:'Scrim',opponent:'Team',map,attW:null,attL:null,defW:null,defL:null,ourScore:ours,theirScore:theirs,sourceMetadata:source});
const stat=(id:string,matchId:string,playerId:string,appearanceType:'core'|'tryout',extra:any={})=>({id,matchId,playerId,displayNameSnapshot:id,player:id,appearanceType,agent:'Sova',kAtt:null,kDef:null,dAtt:null,dDef:null,aAtt:null,aDef:null,kills:null,deaths:null,assists:null,sourceMetadata:source,...extra});
const data:any={matches:[match('m1'),match('m2')],rounds:[],practiceBlocks:[],rosterPlayers:[{id:p1,displayName:'Trial',createdAt:''},{id:p2,displayName:'Core A',createdAt:''},{id:p3,displayName:'Core B',createdAt:''}],playerStats:[stat('trial1','m1',p1,'tryout',{kills:10,deaths:5,assists:4,fk:2,fd:null,acs:200,screenshotMetrics:{coveredRounds:2,wins:1,losses:1,firstKills:0,firstDeaths:0,multikills:{two:0,three:0,four:0,ace:0},lowBudgetWins:0,highBudgetLosses:0,antiEcoLosses:0,kast:{successful:2,covered:2},weapons:[]}}),stat('trial2','m2',p1,'tryout',{kills:8,deaths:4,assists:2,fk:1,fd:1,acs:180}),stat('core1','m1',p2,'core',{kills:20,deaths:10,assists:6,acs:220}),stat('core2','m2',p3,'core',{kills:4,deaths:4,assists:2,acs:160})]};

describe('S4 tryout comparisons',()=>{
  it('compares observed unlinked players when no core roster exists and excludes archived names',()=>{
    const observed:any={matches:[match('observed-match')],rounds:[],practiceBlocks:[],coreMemberships:[],rosterPlayers:[{id:'old',displayName:'Archived',createdAt:'2026-10-01',retiredAt:'2026-10-15'}],playerStats:[
      {id:'candidate',matchId:'observed-match',playerId:null,player:'Candidate',displayNameSnapshot:'Candidate',agent:'Sova',kills:10,deaths:5,assists:2,kAtt:null,kDef:null,dAtt:null,dDef:null,aAtt:null,aDef:null,sourceMetadata:source},
      {id:'archived',matchId:'observed-match',playerId:null,player:'Archived',displayNameSnapshot:'Archived',agent:'Jett',kills:8,deaths:6,assists:1,kAtt:null,kDef:null,dAtt:null,dDef:null,aAtt:null,aDef:null,sourceMetadata:source},
    ]};
    const participants=comparisonParticipants(observed);
    expect(participants.map((player:any)=>player.displayName)).toEqual(['Candidate']);
    const id=participants[0].id; const result=buildTryoutComparison(observed,{mode:'player-player',leftId:id,rightId:id,minimumSamples:1});
    expect(result.metrics.find((metric:any)=>metric.id==='kd')?.left).toBe(2);
  });
  it('preserves missing values and uses only paired K/D and paired opening evidence',()=>{
    const result=buildTryoutComparison(data,{mode:'player-player',leftId:p1,rightId:p2,minimumSamples:1});
    expect(result.metrics.find((item:any)=>item.id==='kd')).toMatchObject({left:2,right:2,leftSamples:2,rightSamples:1});
    expect(result.metrics.find((item:any)=>item.id==='fk')).toMatchObject({left:1.5,leftCoverage:{covered:2,total:2}});
    expect(result.metrics.find((item:any)=>item.id==='openingSuccess')).toMatchObject({left:.5,leftSamples:1});
  });
  it('uses fully covered rounds for KAST and never defaults missing KAST or score to 100%',()=>{
    const changed=structuredClone(data); changed.playerStats[0].screenshotMetrics.kast.covered=1; changed.playerStats[0].screenshotMetrics.kast.successful=1; changed.matches[0].ourScore=null; changed.matches[0].theirScore=null;
    const result=buildTryoutComparison(changed,{mode:'player-player',leftId:p1,rightId:p2,minimumSamples:1});
    expect(result.metrics.find((item:any)=>item.id==='kast')?.left).toBeNull(); expect(result.metrics.find((item:any)=>item.id==='kast')?.leftCoverage).toEqual({covered:0,total:2}); expect(result.metrics.find((item:any)=>item.id==='teamRecord')?.right).toBeNull();
  });
  it('compares a tryout to the per-player core average rather than summed team totals',()=>{
    const result=buildTryoutComparison(data,{mode:'tryout-core-average',leftId:p1,minimumSamples:1});
    expect(result.metrics.find((item:any)=>item.id==='kills')).toMatchObject({left:9,right:12});
  });
  it('supports block, agent, map, and ATT/DEF selectors and excludes unlinked rows',()=>{
    const changed=structuredClone(data); changed.practiceBlocks=[{schema:'moetracker.practice-block/v1',id:'00000000-0000-4000-8000-000000000010',name:'One',matchIds:['m1'],createdAt:'',createdBy:'',updatedAt:'',updatedBy:''},{schema:'moetracker.practice-block/v1',id:'00000000-0000-4000-8000-000000000011',name:'Two',matchIds:['m2'],createdAt:'',createdBy:'',updatedAt:'',updatedBy:''}]; changed.playerStats.push({...changed.playerStats[0],id:'unlinked',playerId:undefined});
    expect(buildTryoutComparison(changed,{mode:'block-block',leftId:changed.practiceBlocks[0].id,rightId:changed.practiceBlocks[1].id,minimumSamples:1}).excluded.unlinkedRows).toBe(1);
    expect(()=>buildTryoutComparison(changed,{mode:'agent-split',leftId:p1,minimumSamples:1})).toThrow('both agents');
    expect(buildTryoutComparison(changed,{mode:'att-def',leftId:p1,minimumSamples:1}).metrics.find((item:any)=>item.id==='kd')?.left).toBeNull();
  });
  it('compares two agents even when the selected agent changes the complete five-agent composition',()=>{
    const changed=structuredClone(data); changed.playerStats=[]; const mates=['00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000022','00000000-0000-4000-8000-000000000023','00000000-0000-4000-8000-000000000024'];
    changed.playerStats.push(stat('left','m1',p1,'tryout',{agent:'Sova',kills:10,deaths:5,assists:2}),stat('right','m2',p1,'tryout',{agent:'Jett',kills:8,deaths:4,assists:2}));
    for(const [index,id] of mates.entries()){changed.rosterPlayers.push({id,displayName:id,createdAt:''});changed.playerStats.push(stat(`l${index}`,'m1',id,'core',{agent:['Omen','Viper','Raze','Sage'][index],kills:1,deaths:1,assists:1}),stat(`r${index}`,'m2',id,'core',{agent:['Omen','Viper','Raze','Sage'][index],kills:1,deaths:1,assists:1}));}
    const result=buildTryoutComparison(changed,{mode:'agent-split',leftId:p1,leftContext:'Sova',rightContext:'Jett',minimumSamples:1}); expect(result.metrics.find((item:any)=>item.id==='kd')).toMatchObject({left:2,right:2});
  });
  it('gates ranks by comparable samples/coverage and orders exact ties deterministically',()=>{
    const ranks=buildCoverageGatedRanks(data,{},1); const kd=ranks.find(item=>item.metricId==='kd')!; expect(kd.ranked).toBe(true); expect(kd.entries.every(item=>item.playerId)).toBe(true);
    expect(ranks.find(item=>item.metricId==='weaponRounds')?.ranked).toBe(false);
  });
  it('does not rank players whose eligible evidence belongs to different cohorts',()=>{
    const changed=structuredClone(data); changed.matches[1].map='Lotus'; changed.playerStats=changed.playerStats.filter((row:any)=>row.playerId!==p1||row.matchId==='m1').filter((row:any)=>row.playerId!==p3||row.matchId==='m2');
    const kd=buildCoverageGatedRanks(changed,{},1).find(item=>item.metricId==='kd')!; expect(kd.entries.map(item=>item.playerId)).toEqual(expect.arrayContaining([p1,p2])); expect(kd.entries.map(item=>item.playerId)).not.toContain(p3);
  });
  it('requires explicit opening provenance and canonical screenshot acceptance',()=>{
    const changed=structuredClone(data); delete changed.playerStats[0].sourceMetadata; changed.matches.push({...match('draft'),sourceMetadata:{method:'screenshot',capturedAt:'2026-10-15T00:00:00Z'},reviewConfirmation:{alliedSideConfirmed:false}}); changed.playerStats.push(stat('draft','draft',p1,'tryout',{kills:99,deaths:1,fk:9,fd:0,sourceMetadata:source}));
    const result=buildTryoutComparison(changed,{mode:'player-player',leftId:p1,rightId:p1,minimumSamples:1}); expect(result.leftMatchIds).not.toContain('draft'); expect(result.metrics.find((item:any)=>item.id==='fk')?.leftSamples).toBe(1);
  });
  it('counts team record once per scored match in block comparisons',()=>{
    const changed=structuredClone(data); changed.practiceBlocks=[{schema:'moetracker.practice-block/v1',id:'00000000-0000-4000-8000-000000000010',name:'One',matchIds:['m1'],createdAt:'',createdBy:'',updatedAt:'',updatedBy:''},{schema:'moetracker.practice-block/v1',id:'00000000-0000-4000-8000-000000000011',name:'Two',matchIds:['m2'],createdAt:'',createdBy:'',updatedAt:'',updatedBy:''}];
    const metric=buildTryoutComparison(changed,{mode:'block-block',leftId:changed.practiceBlocks[0].id,rightId:changed.practiceBlocks[1].id,minimumSamples:1}).metrics.find((item:any)=>item.id==='teamRecord'); expect(metric).toMatchObject({leftSamples:1,rightSamples:1});
  });
  it('exports exact evidence context safely and excludes private notes',()=>{
    const changed=structuredClone(data); changed.rosterPlayers[0].displayName='=FORMULA, Player';
    const exported=buildEvaluationExport(changed,{mode:'player-player',leftId:p1,rightId:p2,filters:{maps:['Ascent']},minimumSamples:1},[{text:'private secret'}] as any);
    expect(exported.content).toContain('Africa/Cairo'); expect(exported.content).toContain('"\'=FORMULA, Player"'); expect(exported.content).not.toContain('private secret'); expect(exported.content).toContain('Left coverage');
  });
  it('strips staff notes and actor identities from player/shareable projections',()=>{
    const privateBlock={id:'x',matchIds:['m1'],createdBy:'coach-actor-sentinel',updatedBy:'coach-actor-sentinel'}; const db:any={...data,settings:{players:[],maps:[],inactiveMaps:[]},coreMemberships:[],tryoutBatches:[],seasonArchives:[{id:'archive',tryoutDecisionNotes:[{text:'archived-secret-sentinel'}],practiceBlocks:[privateBlock]}],rounds:[],schedule:[],goals:[],soloq:[],vetos:[],strats:[],stratRuns:[],tryoutDecisionNotes:[{text:'secret'}],practiceBlocks:[privateBlock]};
    const player=toPublicTrackerData(db,'player'); expect(player.tryoutDecisionNotes).toBeUndefined(); expect(player.practiceBlocks[0].createdBy).toBeUndefined();
    expect('tryoutDecisionNotes' in toWebsiteTrackerData(db,'coach')).toBe(false); const shareable=buildShareableBackupPayload(db); expect(shareable.tryoutDecisionNotes).toBeUndefined(); expect(JSON.stringify(shareable)).not.toContain('archived-secret-sentinel'); expect(JSON.stringify(shareable)).not.toContain('coach-actor-sentinel');
    const portable=createPortablePackage(db,'device'); expect((portable.payload.collections as any).tryoutDecisionNotes).toBeUndefined(); expect(portable.payload.collections.practiceBlocks[0].createdBy).toBeUndefined(); expect(JSON.stringify(portable)).not.toContain('archived-secret-sentinel'); expect(JSON.stringify(portable)).not.toContain('coach-actor-sentinel');
  });
  it('rejects reactivating archived identities',()=>{
    const db:any={settings:{players:[]},rosterPlayers:[{id:p1,displayName:'Archived',createdAt:'',retiredAt:'2026-10-15T00:00:00Z'}],coreMemberships:[],tryoutBatches:[{id:'00000000-0000-4000-8000-000000000099',name:'Batch',status:'active',candidatePlayerIds:[p1],createdAt:''}]};
    expect(()=>addCoreMembership(db,p1)).toThrow('Archived'); expect(()=>addTryoutCandidate(db,db.tryoutBatches[0].id,p1)).toThrow('Archived'); expect(()=>promoteTryoutCandidate(db,db.tryoutBatches[0].id,p1)).toThrow('Archived');
  });
  it('archives and restores practice blocks and private decision history with the season',()=>{
    const db:any={settings:{season:'S',players:[],inactivePlayers:[],riotIds:{}},rosterPlayers:[],coreMemberships:[],tryoutBatches:[],seasonArchives:[],schedule:[],goals:[],matches:[match('m1')],playerStats:[],soloq:[],rounds:[],vetos:[],stratRuns:[],vodReviews:[],strats:[],practiceBlocks:[{id:'b',matchIds:['m1']}],tryoutDecisionNotes:[{id:'n',playerId:p1,text:'keep'}],authKeys:[],allowedUsers:[]};
    const archive=archiveAndResetSeason(db,'Archive','Next',()=> '00000000-0000-4000-8000-000000000088',()=> '2026-10-15T00:00:00Z'); expect(db.practiceBlocks).toEqual([]); expect(archive.tryoutDecisionNotes[0].text).toBe('keep'); restoreSeasonArchive(db,archive.id); expect(db.practiceBlocks[0].id).toBe('b'); expect(db.tryoutDecisionNotes[0].text).toBe('keep');
  });
  it('accepts explicit coach-authored opponent and role context through normal match persistence',()=>{
    const parsed=saveMatchSchema.parse({match:{id:'m',opponentCategory:'academy'},statsUpdate:{operation:'replace',stats:[{playerId:p1,roleSnapshot:'initiator'}]}}); expect(parsed.match.opponentCategory).toBe('academy'); expect((parsed.statsUpdate as any).stats[0].roleSnapshot).toBe('initiator');
  });
});
