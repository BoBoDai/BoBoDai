import { readFile, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

const account = 'BoBoDai';
const template = new URL('./mission-control.svg', import.meta.url);
const output = new URL('../assets/mission-control.svg', import.meta.url);
const dayMs = 86_400_000;
const now = new Date();
const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
const day = offset => new Date(today + offset * dayMs).toISOString().slice(0, 10);
const weeks = [-28, -21, -14, -7].map(offset => ({
  start: day(offset),
  end: day(offset + 6),
}));

async function count(endpoint, qualifier) {
  const query = new URLSearchParams({ q: `author:${account} is:public ${qualifier}`, per_page: '1' });
  const url = `https://api.github.com/search/${endpoint}?${query}`;
  for (const wait of [0, 3_000, 65_000]) {
    if (wait) await delay(wait);
    const response = await fetch(url, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': `${account}-profile-dashboard` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      if ([403, 429, 502, 503, 504].includes(response.status)) continue;
      throw new Error(`GitHub search returned ${response.status} for ${qualifier}`);
    }
    const { total_count: total, incomplete_results: incomplete } = await response.json();
    if (!incomplete && Number.isSafeInteger(total) && total >= 0) return total;
  }
  throw new Error(`No complete GitHub search result for ${qualifier}`);
}

function renderChart(activity) {
  const peak = Math.max(1, ...activity.map(week => week.total));
  return activity.map(({ start, end, total }, index) => {
    const x = 397 + 130 * index;
    const top = 309 - Math.round(84 * total / peak);
    const bar = total
      ? `<rect x="${x - 35}" y="${top}" width="70" height="${309 - top}" rx="3" fill="url(#bar)"/>`
      : `<path d="M${x - 35} 308h70" stroke="#5b7c84"/>`;
    return `<g text-anchor="middle">
      ${bar}
      <text x="${x}" y="${top - 7}" class="number" font-size="15">${total}</text>
      <text x="${x}" y="334" class="label" font-size="12">${start.slice(5)} – ${end.slice(5)}</text>
    </g>`;
  }).join('\n  ');
}

const window = `${weeks[0].start}..${weeks.at(-1).end}`;
const open = await count('issues', 'is:pr is:open');
const opened = await count('issues', `is:pr created:${window}`);
const merged = await count('issues', `is:pr is:merged merged:${window}`);
for (const week of weeks) {
  week.total = await count('commits', `author-date:${week.start}..${week.end}`);
}
const total = weeks.reduce((sum, week) => sum + week.total, 0);

const fields = {
  SUMMARY: `Public GitHub activity for ${account}. Pull requests: ${open} currently open, ${opened} opened and ${merged} merged in the last 28 complete UTC days. Default-branch commits in that same period: ${total}.`,
  PRS_OPEN: open,
  PRS_OPENED: opened,
  PRS_MERGED: merged,
  COMMITS: total,
  CHART: renderChart(weeks),
  UPDATED: day(0),
};
const document = await readFile(template, 'utf8');
const rendered = document.replace(/\{\{([A-Z_]+)\}\}/g, (_, key) => {
  if (!Object.hasOwn(fields, key)) throw new Error(`Unknown SVG field ${key}`);
  return fields[key];
});
await writeFile(output, rendered);
console.log(fields.SUMMARY);
