// 每日科技脈動：抓取各來源 → 產出 reports/YYYY-MM-DD.md → 更新 README 最新區塊。
import { writeFile, mkdir, readFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fetchHackerNews,
  fetchLobsters,
  fetchGitHubTrending,
  fetchRSS,
  fetchBnext,
} from './sources.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPORTS_DIR = join(ROOT, 'reports');

// 以 UTC+8 取得當日日期，確保報告檔名與台灣日期一致。
function today() {
  const tz = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return tz.toISOString().slice(0, 10);
}

function section(title, items) {
  if (!items.length) return `## ${title}\n\n_（今日無資料）_\n`;
  const lines = items.map((it) => {
    const meta = it.meta ? ` — ${it.meta}` : '';
    return `- [${it.title}](${it.url})${meta}`;
  });
  return `## ${title}\n\n${lines.join('\n')}\n`;
}

// 可選：若提供 ANTHROPIC_API_KEY，用 Claude 產生當日一句話脈動摘要。
async function summarize(allItems) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const titles = allItems.slice(0, 30).map((it) => `- ${it.title}`).join('\n');
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [
          {
            role: 'user',
            content: `以下是今日科技頭條，請用臺灣繁體中文寫一段 2-3 句的當日科技脈動摘要：\n\n${titles}`,
          },
        ],
      }),
    });
    const data = await res.json();
    return data?.content?.[0]?.text?.trim() || null;
  } catch (err) {
    console.warn(`摘要產生失敗：${err.message}`);
    return null;
  }
}

async function main() {
  const date = today();
  await mkdir(REPORTS_DIR, { recursive: true });

  const [hn, lobsters, gh, rss, bnext] = await Promise.all([
    fetchHackerNews(10).catch((e) => (console.warn('HN:', e.message), [])),
    fetchLobsters(10).catch((e) => (console.warn('Lobsters:', e.message), [])),
    fetchGitHubTrending(10).catch((e) => (console.warn('GitHub:', e.message), [])),
    fetchRSS(5).catch((e) => (console.warn('RSS:', e.message), [])),
    fetchBnext(5).catch((e) => (console.warn('Bnext:', e.message), [])),
  ]);
  const media = [...rss, ...bnext];

  const summary = await summarize([...hn, ...lobsters, ...gh, ...media]);

  const body = [
    `# 科技脈動 · ${date}`,
    '',
    summary ? `> ${summary}\n` : '',
    section('🔥 Hacker News Top', hn),
    '',
    section('🦞 Lobsters 熱門', lobsters),
    '',
    section('⭐ GitHub Trending（近一週）', gh),
    '',
    section('📰 技術媒體', media),
    '',
    `---\n_自動產生於 ${new Date().toISOString()}_`,
  ]
    .filter((s) => s !== '')
    .join('\n');

  const reportPath = join(REPORTS_DIR, `${date}.md`);
  await writeFile(reportPath, body + '\n');
  console.log(`已產生 ${reportPath}`);

  await updateReadme(date);
}

// 更新 README：僅列出最近 7 天（含當日）的報告，超過一週的自動移除。
// 例：今日 6/8 → 顯示 6/2~6/8，6/1 不再列出（檔案仍保留在 reports/）。
async function updateReadme(latest) {
  const cutoff = new Date(`${latest}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - 6); // 含當日共 7 天
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const files = (await readdir(REPORTS_DIR))
    .filter((f) => f.endsWith('.md') && f.slice(0, 10) >= cutoffStr) // 檔名為 YYYY-MM-DD，可直接字串比較
    .sort()
    .reverse();
  const list = files.map((f) => `- [${f.replace('.md', '')}](reports/${f})`).join('\n');
  const readmePath = join(ROOT, 'README.md');
  let readme = '';
  try {
    readme = await readFile(readmePath, 'utf8');
  } catch {
    readme = TEMPLATE;
  }
  const block = `<!-- PULSE:START -->\n## 最新報告\n\n${list}\n<!-- PULSE:END -->`;
  readme = /<!-- PULSE:START -->[\s\S]*<!-- PULSE:END -->/.test(readme)
    ? readme.replace(/<!-- PULSE:START -->[\s\S]*<!-- PULSE:END -->/, block)
    : `${readme.trim()}\n\n${block}\n`;
  await writeFile(readmePath, readme);
  console.log(`已更新 README（最新：${latest}）`);
}

const TEMPLATE = `# tech-pulse

每日自動彙整 Hacker News、GitHub Trending 與技術媒體頭條，產出當日科技脈動報告。
`;

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
