import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import TryoutComparisons from '../src/components/TryoutComparisons';

const playerId='00000000-0000-4000-8000-000000000001';
const data:any={settings:{maps:['Ascent'],players:[]},rosterPlayers:[{id:playerId,displayName:'Candidate',createdAt:'2026-10-15T00:00:00Z'}],coreMemberships:[],tryoutBatches:[],seasonArchives:[],practiceBlocks:[],tryoutDecisionNotes:[{id:'n',playerId,text:'staff only',updatedAt:'2026-10-15T00:00:00Z'}],matches:[{id:'m',date:'2026-10-15',type:'Scrim',opponent:'Team',map:'Ascent',attW:null,attL:null,defW:null,defL:null,ourScore:13,theirScore:8,sourceMetadata:{method:'manual',capturedAt:'2026-10-15T00:00:00Z'}}],playerStats:[{id:'s',matchId:'m',playerId,player:'Candidate',displayNameSnapshot:'Candidate',appearanceType:'tryout',agent:'Sova',kills:10,deaths:5,assists:2,kAtt:null,kDef:null,dAtt:null,dDef:null,aAtt:null,aDef:null,sourceMetadata:{method:'manual',capturedAt:'2026-10-15T00:00:00Z'}}],rounds:[],schedule:[],goals:[],soloq:[],vetos:[],strats:[],stratRuns:[],secrets:{},serverTime:'2026-10-15'};

describe('tryout comparison UI contract',()=>{
  it('renders semantic named controls, mirrored table text, and non-color direction labels',()=>{
    const html=renderToStaticMarkup(<TryoutComparisons data={data} role="player" theme={{}} onRefresh={async()=>{}} mapScope={{scope:'all',sourceMatchCount:1,includedMatchCount:1,excludedMatchCount:0,emptyActivePool:false}}/>);
    expect(html).toContain('aria-labelledby="comparison-page-title"'); expect(html).toContain('aria-label="Mode"'); expect(html).toContain('<table'); expect(html).toContain('Higher is favorable'); expect(html).toContain('Neutral context');
    expect(html).not.toContain('Private staff decision'); expect(html).not.toContain('staff only');
  });
  it('exposes keyboard-sized coach controls and the private decision surface only to coaches',()=>{
    const html=renderToStaticMarkup(<TryoutComparisons data={data} role="coach" theme={{}} onRefresh={async()=>{}} mapScope={{scope:'active',sourceMatchCount:1,includedMatchCount:1,excludedMatchCount:0,emptyActivePool:false}}/>);
    expect(html).toContain('Private staff decision'); expect(html).toContain('aria-label="Private staff decision note"'); expect(html).toContain('min-h-11'); expect(html).toContain('configured active pool');
  });
});
