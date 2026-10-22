function collectChildOutput(child, label = 'Replay collector') {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    child.stdout?.setEncoding?.('utf8');
    child.stderr?.setEncoding?.('utf8');
    child.stdout?.on('data', value => { stdout += String(value); });
    child.stderr?.on('data', value => { stderr += String(value); });
    child.on('error', error => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    // `exit` may occur before stdout and stderr have finished flushing on
    // Windows. `close` is emitted only after those streams are closed.
    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || `${label} exited with code ${code ?? 'unknown'}${signal ? ` (${signal})` : ''}.`));
    });
  });
}

async function collectJson(run, args, options = {}) {
  const attempts = Math.max(1, Number(options.attempts || 2));
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const output = await run(args);
    try {
      if (!output) throw new SyntaxError('empty response');
      return JSON.parse(output);
    } catch (error) {
      lastError = error;
    }
  }
  const command = String(args?.[0] || 'command');
  throw new Error(`Replay collector returned an incomplete response for ${command}. Moe Tracker retried it safely; try once more or export a support bundle.` , { cause: lastError });
}

module.exports = { collectChildOutput, collectJson };
