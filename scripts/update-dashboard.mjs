import { readFile, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

const account = 'BoBoDai';
const template = new URL('./mission-control.svg', import.meta.url);
const output = new URL('../assets/flight-deck.svg', import.meta.url);
const dayMs = 86_400_000;
const now = new Date();
const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
const day = offset => new Date(today + offset * dayMs).toISOString().slice(0, 10);
const request = path => fetch(`https://api.github.com${path}`, {
  headers: { Accept: 'application/vnd.github+json', 'User-Agent': `${account}-profile-dashboard` },
  signal: AbortSignal.timeout(20_000),
});

async function search(endpoint, qualifier, perPage = 1, page = 1) {
  const query = new URLSearchParams({
    q: `author:${account} is:public ${qualifier}`,
    per_page: String(perPage),
    page: String(page),
  });
  for (const wait of [0, 3_000, 65_000]) {
    if (wait) await delay(wait);
    const response = await request(`/search/${endpoint}?${query}`);
    if (!response.ok) {
      await response.body?.cancel();
      if ([403, 429, 502, 503, 504].includes(response.status)) continue;
      throw new Error(`GitHub search returned ${response.status} for ${qualifier}`);
    }
    const result = await response.json();
    if (!result.incomplete_results && Number.isSafeInteger(result.total_count)
        && result.total_count >= 0 && Array.isArray(result.items)) return result;
  }
  throw new Error(`No complete GitHub search result for ${qualifier}`);
}

async function dailyCommits() {
  const totals = new Map(Array.from({ length: 28 }, (_, index) => [day(index - 28), 0]));
  const range = `author-date:${day(-28)}T00:00:00Z..${day(-1)}T23:59:59Z`;
  const pageSize = 100;
  const first = await search('commits', range, pageSize);
  if (first.total_count > 1_000) throw new Error('Commit search exceeded its 1,000-result limit');

  let result = first;
  for (let page = 1; page <= Math.max(1, Math.ceil(first.total_count / pageSize)); page++) {
    if (page > 1) result = await search('commits', range, pageSize, page);
    for (const { commit } of result.items) {
      const date = new Date(commit.author.date).toISOString().slice(0, 10);
      if (!totals.has(date)) throw new Error(`Commit dated ${date} outside the UTC window`);
      totals.set(date, totals.get(date) + 1);
    }
  }
  return [...totals.entries()];
}

async function readPublicData(path) {
  const response = await request(path);
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`GitHub repository API returned ${response.status}`);
  }
  return response.json();
}

async function languageTotals() {
  const repositories = [];
  for (let page = 1; ; page++) {
    const results = await readPublicData(`/users/${account}/repos?type=owner&per_page=100&page=${page}`);
    repositories.push(...results.filter(repo => !repo.private && !repo.fork
      && repo.name.toLowerCase() !== account.toLowerCase()));
    if (results.length < 100) break;
  }

  const totals = new Map();
  for (let index = 0; index < repositories.length; index += 4) {
    const batch = repositories.slice(index, index + 4);
    const results = await Promise.all(batch.map(({ name }) =>
      readPublicData(`/repos/${account}/${encodeURIComponent(name)}/languages`)));
    for (const languages of results) {
      for (const [language, bytes] of Object.entries(languages)) {
        if (language !== 'HTML' && bytes > 0) {
          totals.set(language, (totals.get(language) ?? 0) + bytes);
        }
      }
    }
  }
  return [...totals].sort(([a, bytesA], [b, bytesB]) => bytesB - bytesA || a.localeCompare(b));
}

const heat = ['#283740', '#42677a', '#6d8e91', '#bf985d', 'url(#heat)'];

function renderChart(activity) {
  const peak = Math.max(1, ...activity.map(([, count]) => count));
  const rows = [];
  for (let row = 0; row < 4; row++) {
    const week = activity.slice(row * 7, row * 7 + 7);
    const y = 205 + 32 * row;
    const cells = week.map(([date, count], column) => {
      const x = 405 + 64 * column;
      const level = Math.ceil(4 * count / peak);
      const content = count
        ? `<text x="${x + 28}" y="${y + 18}" text-anchor="middle" font-size="13" font-weight="700" fill="${level > 1 ? '#19252c' : '#fff7e0'}">${count}</text>`
        : '';
      return `<g><title>${date} UTC: ${count} ${count === 1 ? 'commit' : 'commits'}</title><rect x="${x}" y="${y}" width="56" height="26" rx="4" fill="${heat[level]}" stroke="#526369"/>${content}</g>`;
    }).join('\n    ');
    const start = week[0][0].slice(5).replace('-', '.');
    rows.push(`<text x="338" y="${y + 18}" class="label screen-label">${start}</text>\n    ${cells}`);
  }
  return rows.join('\n    ');
}

const languageColors = ['#45687d', '#ac4e38', '#bc9755', '#66847e', '#d18a56', '#80746d', '#695d73'];
const escapeXml = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

function renderLanguages(languages) {
  if (!languages.length) {
    return { bars: '', legend: '<text x="48" y="483" class="label">NO LANGUAGE DATA</text>', summary: 'No language data.' };
  }
  const bytes = languages.reduce((sum, [, count]) => sum + count, 0);
  const entries = languages.length <= languageColors.length ? languages : [
    ...languages.slice(0, 6), ['Other', languages.slice(6).reduce((sum, [, count]) => sum + count, 0)],
  ];
  let left = 48;
  const bars = [];
  const legend = [];
  const summary = [];
  entries.forEach(([name, count], index) => {
    const color = languageColors[index];
    const percent = 100 * count / bytes;
    const percentText = percent < 0.1 ? '<0.1%' : `${percent.toFixed(1)}%`;
    const width = 804 * count / bytes;
    const x = 48 + Math.round(804 * index / entries.length);
    const nameLabel = name.length > 13 ? `${name.slice(0, 12)}…` : name;
    const detail = `${escapeXml(name)}: ${escapeXml(percentText)}`;
    bars.push(`<g><title>${detail}</title><rect x="${left.toFixed(2)}" y="431" width="${width.toFixed(2)}" height="20" fill="${color}"/></g>`);
    legend.push(`<g><title>${detail}</title><rect x="${x}" y="466" width="9" height="9" rx="1.4" fill="${color}"/><text x="${x + 14}" y="475" class="label" style="font-size:12px;letter-spacing:0">${escapeXml(nameLabel)}</text><text x="${x + 14}" y="494" class="metric" font-size="15">${escapeXml(percentText)}</text></g>`);
    summary.push(detail);
    left += width;
  });
  return {
    bars: `<g clip-path="url(#language-rail)">\n      ${bars.join('\n      ')}\n    </g>`,
    legend: legend.join('\n    '),
    summary: `Languages by bytes in own public repositories, excluding HTML: ${summary.join(', ')}.`,
  };
}

const [{ total_count: merged }, activity, languages] = await Promise.all([
  search('issues', 'is:pr is:merged'),
  dailyCommits(),
  languageTotals(),
]);
const total = activity.reduce((sum, [, count]) => sum + count, 0);
const activeDays = activity.filter(([, count]) => count > 0).length;
const languageMix = renderLanguages(languages);

const fields = {
  SUMMARY: `Public GitHub activity for ${account}. All-time merged pull requests: ${merged}. Default-branch commits in the last 28 complete UTC days: ${total} across ${activeDays} active days. ${languageMix.summary}`,
  PRS_MERGED: merged,
  ACTIVE_DAYS: activeDays,
  COMMITS: total,
  CHART: renderChart(activity),
  LANGUAGE_BARS: languageMix.bars,
  LANGUAGE_LEGEND: languageMix.legend,
  UPDATED: day(0),
};
const document = await readFile(template, 'utf8');
const rendered = document.replace(/\{\{([A-Z_]+)\}\}/g, (_, key) => {
  if (!Object.hasOwn(fields, key)) throw new Error(`Unknown SVG field ${key}`);
  return fields[key];
});
await writeFile(output, rendered);
console.log(fields.SUMMARY);
