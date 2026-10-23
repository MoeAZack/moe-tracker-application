const crypto = require('node:crypto');
const WEAPONS = ['classic','shorty','frenzy','ghost','sheriff','stinger','spectre','bucky','judge','bulldog','guardian','phantom','vandal','marshal','outlaw','operator','ares','odin','bandit','warden','knife'];

function normalizeName(value) { return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
function editDistance(left, right) { const row = Array.from({ length: right.length + 1 }, (_, i) => i); for (let i=1;i<=left.length;i+=1) { let diagonal=row[0]; row[0]=i; for (let j=1;j<=right.length;j+=1) { const previous=row[j]; row[j]=Math.min(row[j]+1,row[j-1]+1,diagonal+(left[i-1]===right[j-1]?0:1)); diagonal=previous; } } return row[right.length]; }
// OCR of in-game names drops or swaps letters and cuts long ones short, so a word matches a name when it
// is within ~30% edits of it, or one starts the other over at least 4 letters.
function wordMatchesName(word, needle) { if (word.length<3) return false; if (editDistance(word,needle)<=Math.max(1,Math.floor(needle.length*.3))) return true; const shorter=word.length<needle.length?word:needle, longer=shorter===word?needle:word; return shorter.length>=4&&longer.startsWith(shorter); }
function nameAppears(text, name) { const haystack=normalizeName(text), needle=normalizeName(name); if (!needle || needle.length<3) return false; if (haystack.includes(needle)) return true; return String(text||'').split(/\s+/).map(normalizeName).filter(Boolean).some(word=>wordMatchesName(word,needle)); }
// A player can carry aliases (the in-game name a TAB board showed); any of them places the player.
// Returns where the name starts and how far the matching word is from it (0 = exact), so one feed word
// that loosely fits two of our names goes to the closer one.
function namePosition(text, name) { const normalized=normalizeName(text), needle=normalizeName(name), exact=needle?normalized.indexOf(needle):-1; if (exact>=0) return {index:exact,distance:0}; if (!nameAppears(text,name)) return null; const words=String(text||'').split(/\s+/), at=words.findIndex(word=>wordMatchesName(normalizeName(word),needle)); return at>=0?{index:normalizeName(words.slice(0,at).join('')).length,distance:editDistance(normalizeName(words[at]),needle)}:{index:Number.MAX_SAFE_INTEGER,distance:Number.MAX_SAFE_INTEGER}; }
function orderedNames(text, players) { const placed=players.map(player=>{ const positions=[player.name,...(player.aliases||[])].map(name=>namePosition(text,name)).filter(Boolean).sort((a,b)=>a.distance-b.distance||a.index-b.index); return positions.length?{...player,index:positions[0].index,distance:positions[0].distance}:null; }).filter(Boolean); return placed.filter(player=>{ const rivals=placed.filter(other=>other!==player&&other.index===player.index); return rivals.every(other=>player.distance<=other.distance); }).map(({distance,...player})=>player).sort((a,b)=>a.index-b.index); }
function observationId(kind,timestampMs,text) { return crypto.createHash('sha256').update(`${kind}:${Math.round(timestampMs/250)}:${String(text||'').trim().toLowerCase()}`).digest('hex').slice(0,24); }
function signatureDistance(left,right) { if (!/^[a-f0-9]{16}$/i.test(String(left||''))||!/^[a-f0-9]{16}$/i.test(String(right||''))) return Number.POSITIVE_INFINITY; let value=BigInt(`0x${left}`)^BigInt(`0x${right}`), count=0; while (value) { count+=Number(value&1n); value>>=1n; } return count; }
function applyVisualTemplates(snapshots,templates=[]) { return snapshots.map(snapshot=>{ const ranked=templates.map(template=>({...template,distance:signatureDistance(snapshot.visualSignature,template.signature)})).filter(item=>item.distance<=Number(item.maxDistance??6)).sort((a,b)=>a.distance-b.distance); if (!ranked.length||ranked[1]?.distance===ranked[0].distance) return snapshot; return {...snapshot,visualLabels:[ranked[0].label],visualMatch:{label:ranked[0].label,distance:ranked[0].distance,templateId:ranked[0].id||null}}; }); }

// The OCR'd word that matched a player's name (or alias), so the rest of the row can be split around it.
function matchedWord(line,known) { const names=[known.name,...(known.aliases||[])].map(normalizeName).filter(Boolean); return String(line||'').split(/\s+/).map(normalizeName).find(word=>names.some(name=>wordMatchesName(word,name)))||null; }

// Without a linked scoreboard the opponents' names are unknown. A kill-feed
// row with exactly one of our players still proves one elimination, so the
// other side is kept as an unresolved opponent (never a roster identity) and
// our players' kills and deaths are no longer silently zero.
function unresolvedOpponent(line,known) {
  const normalized=normalizeName(line); const needle=[known.name,...(known.aliases||[])].map(normalizeName).find(name=>name&&normalized.includes(name))||matchedWord(line,known); if (!needle) return null; const at=normalized.indexOf(needle); if (at<0) return null;
  const before=normalized.slice(0,at), after=normalized.slice(at+needle.length); const strip=value=>WEAPONS.reduce((rest,weapon)=>rest.replace(weapon,''),value).replace(/headshot|^hs|hs$/g,'');
  const left=strip(before), right=strip(after); if ((left.length>=3)===(right.length>=3)) return null;
  const key=left.length>=3?left:right; return {name:`unresolved-opponent:${key}`,team:known.team==='ours'?'theirs':'ours',side:left.length>=3?'killer':'victim',unresolved:true};
}

function parseKillFeedSnapshot(snapshot, players) {
  const events=[]; const opponentsUnknown=players.length>0&&players.every(player=>player.team==='ours');
  for (const line of String(snapshot.text||'').split(/[\r\n]+/).map(value=>value.trim()).filter(Boolean)) {
    let names=orderedNames(line,players);
    if (names.length===1&&opponentsUnknown) { const opponent=unresolvedOpponent(line,names[0]); if (!opponent) continue; names=opponent.side==='victim'?[names[0],opponent]:[opponent,names[0]]; }
    if (names.length<2) continue;
    const killer=names[0], victim=names[names.length-1]; if (killer.name===victim.name||killer.team===victim.team) continue;
    const weapon=WEAPONS.find(item=>new RegExp(`\\b${item}\\b`,'i').test(line))||null;
    events.push({ id:observationId('elimination',snapshot.timestampMs,`${killer.name}:${victim.name}`),kind:'elimination',timestampMs:snapshot.timestampMs,firstSeenMs:snapshot.timestampMs,lastSeenMs:snapshot.timestampMs,confidence:Math.min(snapshot.confidence??.72,.94),grade:'video-observation',killer:killer.name,victim:victim.name,killerTeam:killer.team,victimTeam:victim.team,assistants:names.slice(1,-1).filter(item=>item.team===killer.team).map(item=>item.name),weapon:weapon||snapshot.visualLabels?.find(label=>label.startsWith('weapon:'))?.slice(7)||null,headshot:/head\s*shot|headshot|\bhs\b/i.test(line)||snapshot.visualLabels?.includes('kill:headshot')?true:null,visualSignature:snapshot.visualSignature||null,visualMatch:snapshot.visualMatch||null,rawText:line });
  }
  return events;
}

function parseObjectiveSnapshot(snapshot,players=[]) { const text=String(snapshot.text||''), lower=text.toLowerCase(), events=[], names=orderedNames(text,players); const add=kind=>events.push({id:observationId(kind,snapshot.timestampMs,lower),kind,timestampMs:snapshot.timestampMs,confidence:snapshot.confidence??.76,grade:'ocr',player:names[0]?.name,visualSignature:snapshot.visualSignature||null,rawText:text}); if (/spike\s+(planted|plant)/.test(lower)) add('plant'); if (/spike\s+(defused|defuse)|defus(ed|ing)/.test(lower)) add('defuse'); if (/ultimate\s+orb|ult\s+orb|orb\s+captur(ed|e)/.test(lower)) add('orb-capture'); return events; }

function parseRoundStateSnapshot(snapshot) { const text=String(snapshot.text||''), lower=text.toLowerCase(); 
  // The HUD shows "left  m:ss  right"; a bare "m:ss" is the round timer, never a score.
  const hudScores=[...text.matchAll(/(?:^|\s)(\d{1,2})\s+[0-1]?\d:[0-5]\d\s+(\d{1,2})(?=\s|$)/g)], dashScores=[...text.matchAll(/(?:^|\s)(\d{1,2})\s*[-|]\s*(\d{1,2})(?=\s|$)/g)]; // Between rounds and after a disconnect the timer is gone and only the two scores stay: a text that is
  // just two small numbers is kept as 'hud-bare', used only for a partial score.
  // No timer (spike planted, round over, disconnect): exactly two small numbers and only a few stray marks around them (icons read as junk).
  const numbers=text.match(/\d+/g)||[], bare=!hudScores.length&&!dashScores.length&&numbers.length===2&&numbers.every(value=>value.length<=2)&&text.replace(/[\d\s]/g,'').length<=6?numbers:null;
  const scores=[...hudScores,...dashScores].map(match=>[Number(match[1]),Number(match[2])]).filter(([a,b])=>a<=30&&b<=30), scoreSource=hudScores.length?'hud':dashScores.length?'dash':null;
  const bareScore=bare&&Number(bare[0])<=30&&Number(bare[1])<=30?[Number(bare[0]),Number(bare[1])]:null;
   const roundMatch=text.match(/(?:round|rnd)\s*(\d{1,2})/i), timerMatch=text.match(/\b([0-1]?\d):([0-5]\d)\b/); const winner=/attackers?\s+(?:win|won)|attack\s+victory/i.test(text)?'attack':/defenders?\s+(?:win|won)|defen[cs]e\s+victory/i.test(text)?'defense':null; const phase=/buy\s*phase|buy\s+time/i.test(text)?'buy':/round\s+(?:win|won)|victory|defeat|flawless|thrifty|clutch/i.test(text)?'complete':timerMatch?'live':null; if (!scores.length&&!bareScore&&!roundMatch&&!timerMatch&&!winner&&!phase) return null; return {id:observationId('round-state',snapshot.timestampMs,text),kind:'round-state',timestampMs:snapshot.timestampMs,confidence:snapshot.confidence??.7,grade:'ocr',roundNumber:roundMatch?Number(roundMatch[1]):null,score:scores[0]||null,...(scores.length?{scoreSource}:{}),...(bareScore?{bareScore}:{}),timerSeconds:timerMatch?Number(timerMatch[1])*60+Number(timerMatch[2]):null,phase,winner,rawText:text}; }

// The end screen of a custom game reads "ALLIES n - m ENEMIES": Allies is the recording side's team.
function parseEndBannerSnapshot(snapshot) { const text=String(snapshot?.text||''); // Sparse OCR can put each part of the wide line on its own line, so any short non-digit gap is allowed.
  // Two layouts: "ALLIES n - m ENEMIES", and the result word between the scores ("8  DEFEAT  16"), whose word must agree with them.
  const allies=text.match(/\ballies\b[^\d]{0,24}?(\d{1,2})[^\d]{1,24}?(\d{1,2})[^\d]{0,24}?\benemies\b/i), result=allies?null:text.match(/(\d{1,2})[^\d]{0,24}?\b(victory|defeat|draw)\b[^\d]{0,24}?(\d{1,2})/i); if (!allies&&!result) return null;
  const score=allies?[Number(allies[1]),Number(allies[2])]:[Number(result[1]),Number(result[3])]; if (score.some(value=>value>30)||score[0]+score[1]<1) return null;
  if (result) { const word=result[2].toLowerCase(); if ((word==='victory')!==(score[0]>score[1])||(word==='defeat')!==(score[0]<score[1])) return null; } return {id:observationId('end-banner',snapshot.timestampMs,text),kind:'end-banner',timestampMs:snapshot.timestampMs,confidence:snapshot.confidence??.7,grade:'ocr',score,rawText:text}; }

function trackKillFeedRows(snapshots,players,persistenceMs=7000) { const tracked=[]; for (const snapshot of [...snapshots].sort((a,b)=>a.timestampMs-b.timestampMs)) for (const event of parseKillFeedSnapshot(snapshot,players)) { const previous=tracked.findLast(item=>item.killer===event.killer&&item.victim===event.victim&&event.timestampMs-item.lastSeenMs<=persistenceMs); if (previous) { previous.lastSeenMs=event.timestampMs; previous.confidence=Math.max(previous.confidence||0,event.confidence||0); previous.weapon||=event.weapon; previous.headshot||=event.headshot; previous.assistants=[...new Set([...(previous.assistants||[]),...(event.assistants||[])])]; } else tracked.push(event); } return tracked; }

function buildObserverSegments(snapshots,players,explicitPlayer=null,observerMode=false,durationMs=0) { if (explicitPlayer) return [{player:explicitPlayer,startedAtMs:0,endedAtMs:durationMs,confidence:1,source:'explicit'}]; if (!observerMode) return []; const points=snapshots.flatMap(snapshot=>{ const matches=players.filter(player=>nameAppears(snapshot.text,player.name)); return matches.length===1?[{player:matches[0].name,timestampMs:snapshot.timestampMs,confidence:snapshot.confidence??.65}]:[]; }).sort((a,b)=>a.timestampMs-b.timestampMs); const segments=[]; for (const point of points) { const current=segments.at(-1); if (current&&current.player===point.player&&point.timestampMs-current.endedAtMs<=20000) { current.endedAtMs=point.timestampMs; current.confidence=Math.max(current.confidence,point.confidence); } else segments.push({player:point.player,startedAtMs:point.timestampMs,endedAtMs:point.timestampMs,confidence:point.confidence,source:'observer-hud'}); } return segments; }
function observerAt(segments,timestampMs) { return segments.findLast(item=>timestampMs>=item.startedAtMs-2000&&timestampMs<=item.endedAtMs+12000)?.player||null; }

function parseUltimateSnapshots(snapshots,playerAt) { const states=[]; for (const snapshot of snapshots) { const match=[...String(snapshot.text||'').matchAll(/(?:ult(?:imate)?\s*)?(\d{1,2})\s*[\/|]\s*(\d{1,2})/gi)][0]; if (!match) continue; const current=Number(match[1]), required=Number(match[2]); if (current>required||required<5||required>10) continue; const player=typeof playerAt==='function'?playerAt(snapshot.timestampMs):playerAt; const previous=states.at(-1); if (!previous||previous.current!==current||previous.required!==required||previous.player!==player) states.push({id:observationId('ultimate-state',snapshot.timestampMs,`${player}:${current}/${required}`),kind:'ultimate-state',timestampMs:snapshot.timestampMs,confidence:snapshot.confidence??.7,grade:'ocr',player:player||undefined,current,required,rawText:snapshot.text}); } const uses=[], candidates=[]; for (let index=1;index<states.length;index+=1) { const before=states[index-1],after=states[index],gap=after.timestampMs-before.timestampMs; if (!before.player||before.player!==after.player||after.required!==before.required||after.current>1||gap<=0||gap>=20000) continue; if (before.current===before.required) uses.push({id:observationId('ultimate-use',after.timestampMs,before.player),kind:'ultimate-use',timestampMs:after.timestampMs,player:before.player,confidence:Math.min(before.confidence,after.confidence,.88),grade:'video-observation'}); else if (before.current===before.required-1) candidates.push({id:observationId('ultimate-use-candidate',after.timestampMs,before.player),kind:'ultimate-use-candidate',timestampMs:after.timestampMs,player:before.player,confidence:Math.min(before.confidence,after.confidence,.55),grade:'ocr',reason:'not-confirmed-ready'}); } return {states,uses,candidates}; }

function dedupeEvents(events,windowMs=5000) { const kept=[]; for (const event of [...events].sort((a,b)=>a.timestampMs-b.timestampMs)) { const duplicate=kept.findLast(item=>item.kind===event.kind&&item.killer===event.killer&&item.victim===event.victim&&item.player===event.player&&(event.kind==='end-banner'?event.timestampMs===item.timestampMs&&JSON.stringify(event.score)===JSON.stringify(item.score):event.timestampMs-item.timestampMs<=windowMs)); if (!duplicate) kept.push(event); else if ((event.confidence||0)>(duplicate.confidence||0)) Object.assign(duplicate,event); } return kept; }
function groupRounds(eliminations,gapMs=22000) { const rounds=[]; for (const event of [...eliminations].sort((a,b)=>a.timestampMs-b.timestampMs)) { const current=rounds.at(-1); if (!current||event.timestampMs-current.events.at(-1).timestampMs>gapMs) rounds.push({roundNumber:rounds.length+1,startedAtMs:event.timestampMs,endedAtMs:event.timestampMs,events:[event],boundarySource:'kill-gap'}); else { current.events.push(event); current.endedAtMs=event.timestampMs; } } return rounds; }

function buildRoundTimeline(roundStates,events) { const states=roundStates.filter(Boolean).sort((a,b)=>a.timestampMs-b.timestampMs), starts=[]; for (const state of states) { const scoreTotal=state.score?state.score[0]+state.score[1]:null, inferred=state.roundNumber||(scoreTotal!==null?scoreTotal+1:null); if (state.phase!=='buy'&&!state.roundNumber&&!state.score) continue; const previous=starts.at(-1); if (!previous||(inferred&&previous.roundNumber!==inferred)||state.timestampMs-previous.timestampMs>75000) starts.push({timestampMs:state.timestampMs,roundNumber:inferred||starts.length+1,score:state.score,confidence:state.confidence}); } if (starts.length<2) return {mode:'inferred',confidence:starts.length ? .45 : .25,rounds:groupRounds(events)}; const rounds=starts.map((start,index)=>{ const next=starts[index+1],endedAtMs=next?Math.max(start.timestampMs,next.timestampMs-1):Math.max(start.timestampMs,events.at(-1)?.timestampMs||start.timestampMs),roundEvents=events.filter(event=>event.timestampMs>=start.timestampMs&&event.timestampMs<=endedAtMs),completed=states.findLast(state=>state.timestampMs>=start.timestampMs&&state.timestampMs<=endedAtMs&&(state.phase==='complete'||state.winner)); return {roundNumber:start.roundNumber,startedAtMs:start.timestampMs,endedAtMs,scoreBefore:start.score||null,winner:completed?.winner||null,events:roundEvents,boundarySource:'round-state'}; }); return {mode:'authoritative',confidence:Math.min(.96,.7+Math.min(.26,starts.length*.015)),rounds}; }

function parseScoreboardSnapshots(snapshots,players) { const rows=[]; for (const snapshot of snapshots) for (const line of String(snapshot.text||'').split(/[\r\n]+/)) { const matched=players.filter(player=>nameAppears(line,player.name)); if (matched.length!==1) continue; const values=[...line.matchAll(/\b\d{1,3}\b/g)].map(match=>Number(match[0])); if (values.length<3) continue; rows.push({playerName:matched[0].name,timestampMs:snapshot.timestampMs,values:values.slice(-6),confidence:snapshot.confidence??.65,rawText:line.trim()}); } const latest=new Map(); for (const row of rows) if (!latest.has(row.playerName)||row.timestampMs>latest.get(row.playerName).timestampMs) latest.set(row.playerName,row); return [...latest.values()].map(row=>({...row,kills:row.values.at(-3)??null,deaths:row.values.at(-2)??null,assists:row.values.at(-1)??null})); }
function reconcileEvidence(evidence,scoreboardRows=[]) { const conflicts=[]; let compared=0; for (const row of scoreboardRows) { const metric=evidence.playerMetrics.find(item=>item.playerName===row.playerName); if (!metric) continue; for (const field of ['kills','deaths']) { if (row[field]===null) continue; compared+=1; if (metric[field]!==row[field]) conflicts.push({playerName:row.playerName,field,timeline:metric[field],scoreboard:row[field]}); } } // Complete means every observed player's kills and deaths were checked, not any
  // ten fields: five rows of one team, or kills alone, must stay partial.
  const checked=new Set(scoreboardRows.filter(row=>row.kills!==null&&row.deaths!==null&&evidence.playerMetrics.some(item=>item.playerName===row.playerName)).map(row=>row.playerName));
  const complete=evidence.playerMetrics.length>=5&&evidence.playerMetrics.every(item=>checked.has(item.playerName))&&conflicts.length===0; if (complete) evidence.coverage.signals.eliminations='complete'; evidence.reconciliation={status:conflicts.length?'conflict':complete?'matched':'partial',comparedFields:compared,conflicts,scoreboardRows}; return evidence; }

const NO_IDENTITIES_LIMITATION='No player names were known for this game (no roster players and no readable scoreboard), so kills, deaths, trades and KAST are not credited to anyone. Add your players under Roster, then import the VOD again to credit them.';
// The names the coach typed are often not the in-game names the kill feed shows. Our TAB rows name the
// in-game five: each row joins the typed player its name loosely matches, and when one row and one
// player are left over they are paired. The in-game name becomes that player's alias.
function learnTabAliases(players,tabBoards=[]) {
  const names=[...new Set((tabBoards||[]).flatMap(board=>(board.rows||[]).map(row=>row.name)).filter(name=>normalizeName(name).length>=3))]; if (!names.length) return players;
  const ours=players.filter(player=>player.team==='ours'); const aliases=new Map(ours.map(player=>[player.name,[]])); const used=new Set();
  const loose=(left,right)=>{ const a=normalizeName(left),b=normalizeName(right); return a.length>=3&&b.length>=3&&(a.includes(b)||b.includes(a)||wordMatchesName(a,b)); };
  for (const name of names) { const match=ours.filter(player=>loose(player.name,name)); if (match.length===1&&!used.has(name)) { aliases.get(match[0].name).push(name); used.add(name); } }
  const leftNames=names.filter(name=>!used.has(name)), leftPlayers=ours.filter(player=>!aliases.get(player.name).length);
  if (leftNames.length===1&&leftPlayers.length===1) aliases.get(leftPlayers[0].name).push(leftNames[0]);
  return players.map(player=>aliases.get(player.name)?.length?{...player,aliases:[...(player.aliases||[]),...aliases.get(player.name)]}:player);
}

// The TAB board the coach opened is the reference for our players' K/D/A up to that moment; the kill
// feed after it adds what happened since. A row is matched to one of our players by name. Without a
// later read the numbers stay partial (the server marks them so).
function applyTabBoards(evidence,tabBoards=[],players=[]) {
  const board=[...(tabBoards||[])].sort((a,b)=>a.timestampMs-b.timestampMs).at(-1); if (!board) return evidence;
  const eliminations=(evidence.observations||[]).filter(item=>item.kind==='elimination'); let matched=0;
  for (const metric of evidence.playerMetrics||[]) {
    if (metric.team!=='ours') continue; const known=[metric.playerName,...(players.find(player=>player.name===metric.playerName)?.aliases||[])]; const row=(board.rows||[]).find(item=>item.name&&known.some(name=>normalizeName(item.name)===normalizeName(name)||nameAppears(item.name,name))); if (!row||![row.kills,row.deaths].every(Number.isInteger)) continue;
    const after=eliminations.filter(event=>event.timestampMs>board.timestampMs);
    metric.kills=row.kills+after.filter(event=>event.killer===metric.playerName).length; metric.deaths=row.deaths+after.filter(event=>event.victim===metric.playerName).length;
    metric.assists=Number.isInteger(row.assists)?row.assists:null; metric.source='tab-board+kill-feed'; matched+=1;
  }
  evidence.tabBoard={timestampMs:board.timestampMs,rows:(board.rows||[]).length,matched,aliases:players.filter(player=>player.aliases?.length).length}; return evidence;
}

function aggregateVideoEvidence({players,killFeedSnapshots=[],objectiveSnapshots=[],ultimateSnapshots=[],roundStateSnapshots=[],scoreboardSnapshots=[],endBannerSnapshots=[],tabBoards=[],povSnapshots=[],povPlayerName=null,observerMode=false,durationMs=0}) { players=learnTabAliases(players,tabBoards); const observerSegments=buildObserverSegments(povSnapshots,players,povPlayerName,observerMode,durationMs), playerAt=timestamp=>povPlayerName||observerAt(observerSegments,timestamp); const eliminations=trackKillFeedRows(killFeedSnapshots,players), objectives=dedupeEvents(objectiveSnapshots.flatMap(snapshot=>parseObjectiveSnapshot(snapshot,players))).map(event=>event.kind==='orb-capture'&&!event.player?{...event,player:playerAt(event.timestampMs)||undefined}:event), ultimate=parseUltimateSnapshots(ultimateSnapshots,playerAt), roundStates=roundStateSnapshots.map(parseRoundStateSnapshot).filter(Boolean), endBanners=[...endBannerSnapshots,...roundStateSnapshots,...objectiveSnapshots,...scoreboardSnapshots].map(parseEndBannerSnapshot).filter(Boolean), timeline=buildRoundTimeline(roundStates,eliminations), rounds=timeline.rounds; const metrics=players.map(player=>{ const kills=eliminations.filter(event=>event.killer===player.name).length,deaths=eliminations.filter(event=>event.victim===player.name).length; let kastSuccessful=0,kastCovered=0,trades=0; for (const round of rounds) { const killed=round.events.some(event=>event.killer===player.name),assisted=round.events.some(event=>event.assistants?.includes(player.name)),died=round.events.find(event=>event.victim===player.name),traded=!!died&&round.events.some(event=>event.killerTeam===player.team&&event.victim===died.killer&&event.timestampMs>died.timestampMs&&event.timestampMs-died.timestampMs<=5000); if (traded) trades+=1; if (round.events.some(event=>event.killerTeam===player.team||event.victimTeam===player.team)) { kastCovered+=1; if (killed||assisted||traded||!died) kastSuccessful+=1; } } const ultimateUses=ultimate.uses.filter(event=>event.player===player.name).length,orbCaptures=objectives.filter(event=>event.kind==='orb-capture'&&event.player===player.name).length; return {playerName:player.name,team:player.team,kills,deaths,trades,ultimateUses:ultimate.states.some(event=>event.player===player.name)?ultimateUses:null,orbCaptures:objectives.some(event=>event.kind==='orb-capture'&&event.player===player.name)?orbCaptures:null,kastSuccessful:kastCovered?kastSuccessful:null,kastCovered:kastCovered||null,kastRate:kastCovered?Math.round(kastSuccessful/kastCovered*1000)/10:null}; }); const expectedTeam=players.filter(player=>player.team==='ours'&&Number.isInteger(player.expectedKills)&&Number.isInteger(player.expectedDeaths)), expectedComplete=expectedTeam.length===5&&expectedTeam.every(player=>{ const observed=metrics.find(metric=>metric.playerName===player.name); return observed&&observed.kills===player.expectedKills&&observed.deaths===player.expectedDeaths; }); const authoritative=timeline.mode==='authoritative'; const coverage={durationMs,killFeedSnapshots:killFeedSnapshots.length,objectiveSnapshots:objectiveSnapshots.length,ultimateSnapshots:ultimateSnapshots.length,roundStateSnapshots:roundStateSnapshots.length,scoreboardSnapshots:scoreboardSnapshots.length,resolvedEliminations:eliminations.length,inferredRoundGroups:rounds.length,temporalAmbiguities:[...new Set(eliminations.map(event=>event.timestampMs))].filter(timestamp=>eliminations.filter(event=>event.timestampMs===timestamp).length>1).length,roundDetection:{mode:timeline.mode,confidence:timeline.confidence,detectedRounds:rounds.length},signals:{eliminations:expectedComplete?'complete':eliminations.length?'partial':'unsupported',trades:rounds.length?'partial':'unsupported',kast:rounds.length?'partial':'unsupported',objectives:objectiveSnapshots.length?'partial':'unsupported',ultimateUse:ultimate.states.length>=2?'partial':'unsupported',orbCapture:objectives.some(event=>event.kind==='orb-capture'&&event.player)?'partial':'unsupported',scoreboard:scoreboardSnapshots.length?'partial':'unsupported',throws:'unsupported'}}; const evidence={schema:'moetracker.vod-timeline-evidence/v2',grade:'video-observation',coverage,observerSegments,observations:[...eliminations,...objectives,...roundStates,...endBanners,...ultimate.states,...ultimate.uses,...ultimate.candidates].sort((a,b)=>a.timestampMs-b.timestampMs),rounds,playerMetrics:metrics,throwCandidates:[],limitations:[authoritative?'Round boundaries use recognized round/score state; unreadable transitions remain reviewable gaps.':'Round-state OCR was insufficient, so round groups fall back to kill-feed gaps.','Kill-feed timing is tracked at adaptive sampled-frame resolution.','Invisible or unreadable HUD events remain unknown.','Throw intent is never inferred as fact.',...(players.length?[]:[NO_IDENTITIES_LIMITATION])]}; return applyTabBoards(reconcileEvidence(evidence,parseScoreboardSnapshots(scoreboardSnapshots,players)),tabBoards,players); }

function fuseVodEvidence(items) {
  const sources=items.filter(Boolean); if (!sources.length) return null;
  const base=structuredClone(sources[0]),all=sources.flatMap(item=>item.observations||[]);
  base.observations=dedupeEvents(all,4000);
  const roundNumbers=[...new Set(sources.flatMap(item=>(item.rounds||[]).map(round=>round.roundNumber)))].sort((a,b)=>a-b);
  base.rounds=roundNumbers.map(roundNumber=>{
    const candidates=sources.flatMap(item=>(item.rounds||[]).filter(round=>round.roundNumber===roundNumber));
    const events=dedupeEvents(candidates.flatMap(round=>round.events||[]),4000);
    const winners=[...new Set(candidates.map(round=>round.winner).filter(Boolean))];
    return { roundNumber,startedAtMs:Math.min(...candidates.map(round=>round.startedAtMs)),endedAtMs:Math.max(...candidates.map(round=>round.endedAtMs)),events,boundarySource:candidates.some(round=>round.boundarySource==='round-state')?'round-state':'kill-gap',winner:winners.length===1?winners[0]:null,scoreBefore:candidates.find(round=>round.scoreBefore)?.scoreBefore||null };
  });
  base.sourceSet=sources.map(item=>item.source).filter(Boolean);
  base.coverage.durationMs=Math.max(...sources.map(item=>item.coverage?.durationMs||0));
  base.coverage.resolvedEliminations=base.observations.filter(item=>item.kind==='elimination').length;
  base.coverage.inferredRoundGroups=base.rounds.length;
  base.coverage.signals=Object.fromEntries([...new Set(sources.flatMap(item=>Object.keys(item.coverage?.signals||{})))].map(key=>[key,sources.some(item=>item.coverage?.signals?.[key]==='complete')?'complete':sources.some(item=>item.coverage?.signals?.[key]==='partial')?'partial':'unsupported']));
  base.fusion={sourceCount:sources.length,fusedAt:new Date().toISOString(),conflicts:sources.flatMap(item=>item.reconciliation?.conflicts||[])};
  base.limitations=[...new Set(sources.flatMap(item=>item.limitations||[]))]; return base;
}

// A score pair the HUD can show: regulation (first to 13), overtime (win by
// two), the final score itself, or a custom game that plays out all 24 rounds.
function plausibleScore([left,right]) { const high=Math.max(left,right), low=Math.min(left,right); return high<=12||(low>=12&&high-low<=1)||(high===13&&low<=11)||(low>=12&&high-low===2)||(low<=11&&left+right<=24); }
// A played-out custom game ends after its 24th round, whatever the split.
const finalScore=([left,right])=>{ const high=Math.max(left,right), low=Math.min(left,right); return (high===13&&low<=11)||(low>=12&&high-low===2)||(low<=11&&left+right===24); };

/**
 * The final score of one game from the HUD score reads (left, right), or null.
 * Reads count only when the reader marked them as HUD scores (older evidence
 * read the round timer as a score). The longest run of reads that never goes
 * down is kept; if the HUD never showed the final score, the last read before
 * the final round decides it, because a game only ends when a side reaches 13
 * (or leads by two in overtime), provided that read is from the final
 * round. Anything else stays unknown.
 */
function deriveFinalScore(evidence, options={}) {
  // The end screen names the sides: Allies first, so it beats any HUD read.
  const banners=(evidence?.observations||[]).filter(item=>item?.kind==='end-banner'&&Array.isArray(item.score)&&item.score.length===2&&item.score.every(Number.isInteger)).sort((a,b)=>a.timestampMs-b.timestampMs);
  if (banners.length&&!options.partial) {
    const groups=new Map(); for (const banner of banners) { const key=banner.score.join(':'), group=groups.get(key)||new Map(); group.set(banner.timestampMs,banner); groups.set(key,group); }
    const confirmed=[...groups.values()].map(group=>[...group.values()].sort((a,b)=>a.timestampMs-b.timestampMs)).filter(group=>group.length>=2).sort((a,b)=>a.at(-1).timestampMs-b.at(-1).timestampMs);
    if (!confirmed.length) return null;
    const group=confirmed.at(-1), [left,right]=group.at(-1).score; return { left, right, basis:'end-banner', reads:group.length };
  }
  const observed=(evidence?.observations||[]).filter(item=>item?.kind==='round-state').map(item=>options.partial&&!item.scoreSource&&item.bareScore?{...item,score:item.bareScore,scoreSource:'hud-bare'}:item).filter(item=>item.scoreSource&&Array.isArray(item.score)&&item.score.length===2&&item.score.every(Number.isInteger)&&plausibleScore(item.score)).sort((a,b)=>a.timestampMs-b.timestampMs).slice(-2000), reads=observed.map(item=>item.score);
  if (!reads.length) return null;
  const length=reads.map(()=>1), previous=reads.map(()=>-1);
  for (let index=0; index<reads.length; index+=1) for (let before=0; before<index; before+=1) if (reads[before][0]<=reads[index][0]&&reads[before][1]<=reads[index][1]&&length[before]+1>length[index]) { length[index]=length[before]+1; previous[index]=before; }
  let end=0; for (let index=1; index<reads.length; index+=1) if (length[index]>=length[end]) end=index;
  // A partial score (game cut off) is kept from two agreeing-in-order reads; a final needs three.
  const chain=length[end]; if (chain<(options.partial?2:3)) return null;
  const [left,right]=reads[end];
  if (options.partial) return { left, right, basis:'last-hud', reads:chain };
  // Repeated HUD reads prove only the latest observed state. They never prove
  // that play ended there or that the next round was won by either side.
  return null;
}

// A game with no final score (no end screen, the VOD cut off or the game abandoned) still showed a
// HUD score: the last read of the rising HUD chain, kept as partial and never as a result.
function deriveLastHudScore(evidence) { return deriveFinalScore(evidence,{partial:true}); }

module.exports={learnTabAliases,wordMatchesName,applyTabBoards,deriveLastHudScore,NO_IDENTITIES_LIMITATION,normalizeName,nameAppears,signatureDistance,applyVisualTemplates,parseKillFeedSnapshot,parseObjectiveSnapshot,parseRoundStateSnapshot,parseEndBannerSnapshot,parseUltimateSnapshots,parseScoreboardSnapshots,trackKillFeedRows,buildObserverSegments,observerAt,dedupeEvents,groupRounds,buildRoundTimeline,reconcileEvidence,aggregateVideoEvidence,fuseVodEvidence,deriveFinalScore};
