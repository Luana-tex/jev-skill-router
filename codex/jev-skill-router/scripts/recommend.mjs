const args = process.argv.slice(2);
const command = args[0] === 'doctor' || args[0] === 'cache-clear' || args[0] === 'analytics' ? args.shift() : 'codex-recommend';
process.argv = [process.execPath, import.meta.filename, command, ...args];
try {
  await import('../../../dist/cli.js');
} catch {
  const diagnostic = { code: 'installation-unavailable' };
  const report = command === 'doctor'
    ? { installation: { status: 'unavailable' }, diagnostic, network: 'not-checked' }
    : { status: 'native-fallback', reason: 'installation-unavailable', recommendations: [], diagnostic };
  console.log(JSON.stringify(report));
  process.exitCode = 1;
}
