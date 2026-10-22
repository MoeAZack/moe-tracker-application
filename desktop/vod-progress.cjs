// One game's timeline scan as a single percentage that never goes backwards.
// The scan reports each stage from 0 to 100; here each stage gets a fixed
// share of the game, and a stage that restarts (a decode fallback) can not
// pull the total back down.
const GAME_STAGES = [
  { stages: ['probe'], label: 'Checking the video', from: 0, to: 2 },
  { stages: ['sampling'], label: 'Sampling the HUD', from: 2, to: 40 },
  { stages: ['ocr', 'complete'], label: 'Reading HUD text', from: 40, to: 100 },
];

function gameProgressReporter(progress) {
  let best = 0;
  return update => {
    const index = GAME_STAGES.findIndex(stage => stage.stages.includes(update.stage));
    if (index < 0) return progress?.(update);
    const stage = GAME_STAGES[index];
    const share = update.stage === 'complete' ? 100 : Number.isFinite(update.percent) ? Math.max(0, Math.min(100, update.percent)) : 0;
    best = Math.max(best, stage.from + (stage.to - stage.from) * share / 100);
    return progress?.({ ...update, gamePercent: Math.round(best), stageIndex: index + 1, stageCount: GAME_STAGES.length, stageLabel: stage.label });
  };
}

// Region i of n sampled on its own decode reports 0-100; scale it into the
// whole sampling stage so the regions add up instead of each restarting.
function regionProgress(progress, index, count) {
  return progress && (update => progress({ ...update, percent: Number.isFinite(update.percent) ? Math.round((index * 100 + update.percent) / Math.max(1, count)) : update.percent }));
}

module.exports = { GAME_STAGES, gameProgressReporter, regionProgress };
