import { validDate } from './history.mjs';

export function parseArgs(argv) {
  const positional = [], options = { history: false, cap: undefined, recentDays: 90, asOf: undefined, json: false, dataDir: 'data', help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--history') options.history = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (['--limit', '--recent-days', '--as-of', '--data-dir'].includes(arg)) {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
      if (arg === '--limit') options.cap = value === 'all' ? Infinity : Number(value);
      if (arg === '--recent-days') options.recentDays = Number(value);
      if (arg === '--as-of') options.asOf = value;
      if (arg === '--data-dir') options.dataDir = value;
    } else if (arg.startsWith('-')) throw new Error(`unknown option ${arg}`);
    else positional.push(arg);
  }
  if (positional.length > 2) throw new Error('quote a multi-word insider name as one argument');
  if (options.cap !== undefined && options.cap !== Infinity && (!Number.isSafeInteger(options.cap) || options.cap < 1)) throw new Error('--limit must be a positive integer or all');
  if (!Number.isSafeInteger(options.recentDays) || options.recentDays < 1 || options.recentDays > 36500) throw new Error('--recent-days must be an integer from 1 to 36500');
  if (options.asOf && !validDate(options.asOf)) throw new Error('--as-of must be a real YYYY-MM-DD date');
  const [command, argument] = positional;
  if (command !== 'who' && (options.asOf || options.json || options.recentDays !== 90)) throw new Error('--as-of, --json and --recent-days currently apply only to who');
  return { command, argument, options };
}
