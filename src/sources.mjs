// 資料來源設定與抓取邏輯。每個來源回傳統一格式：
//   { title, url, meta }
// meta 為顯示用的補充字串（分數、星數、來源站台等）。

const UA = { 'User-Agent': 'tech-pulse (https://github.com/)' };

async function getJSON(url, headers = {}) {
  const res = await fetch(url, { headers: { ...UA, ...headers } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

async function getText(url, headers = {}) {
  const res = await fetch(url, { headers: { ...UA, ...headers } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.text();
}

// Hacker News 官方 Firebase API，免金鑰。
export async function fetchHackerNews(limit = 10) {
  const ids = await getJSON('https://hacker-news.firebaseio.com/v0/topstories.json');
  const top = ids.slice(0, limit);
  const items = await Promise.all(
    top.map((id) => getJSON(`https://hacker-news.firebaseio.com/v0/item/${id}.json`))
  );
  return items
    .filter((it) => it && it.title)
    .map((it) => ({
      title: it.title,
      url: it.url || `https://news.ycombinator.com/item?id=${it.id}`,
      meta: `${it.score ?? 0} 分 · ${it.descendants ?? 0} 則討論`,
    }));
}

// Lobsters 熱門，官方 JSON API，免金鑰。
export async function fetchLobsters(limit = 10) {
  const items = await getJSON('https://lobste.rs/hottest.json');
  return items.slice(0, limit).map((it) => ({
    title: it.title,
    url: it.url || it.comments_url,
    meta: `${it.score ?? 0} 分 · ${it.comment_count ?? 0} 則討論`,
  }));
}

// GitHub API 共用標頭（Actions 環境會帶 GITHUB_TOKEN 以提高速率上限）。
function githubHeaders() {
  const headers = { Accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return headers;
}

// GitHub 近一週新建、星數最高的 repo（用 Search API，免額外金鑰）。
export async function fetchGitHubTrending(limit = 10) {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const data = await getJSON(
    `https://api.github.com/search/repositories?q=created:>${since}&sort=stars&order=desc&per_page=${limit}`,
    githubHeaders()
  );
  return (data.items || []).map((repo) => ({
    title: `${repo.full_name}${repo.language ? ` (${repo.language})` : ''}`,
    url: repo.html_url,
    meta: `★ ${repo.stargazers_count} · ${repo.description || '（無描述）'}`.slice(0, 160),
  }));
}

// 關注清單：追蹤這些 repo 的新版本。要增減直接改這份清單即可。
const WATCHED_REPOS = [
  'nodejs/node',
  'oven-sh/bun',
  'denoland/deno',
  'microsoft/TypeScript',
  'facebook/react',
  'vercel/next.js',
];

// 各 repo 的最新 release，只保留近 7 天內發布的（避免每天重複列出舊版本）。
export async function fetchGitHubReleases(repos = WATCHED_REPOS) {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const results = await Promise.all(
    repos.map(async (repo) => {
      try {
        const rel = await getJSON(
          `https://api.github.com/repos/${repo}/releases/latest`,
          githubHeaders()
        );
        if (!rel.published_at || new Date(rel.published_at).getTime() < cutoff) return null;
        return {
          title: `${repo} ${rel.tag_name || rel.name || ''}`.trim(),
          url: rel.html_url,
          meta: `發布於 ${rel.published_at.slice(0, 10)}`,
        };
      } catch {
        return null; // 無 release 或僅有 pre-release 會回 404，略過。
      }
    })
  );
  return results.filter(Boolean);
}

// arXiv 最新 AI 論文（官方 Atom API），預設 cs.AI。
export async function fetchArxiv(category = 'cs.AI', limit = 5) {
  const xml = await getText(
    `http://export.arxiv.org/api/query?search_query=cat:${category}&sortBy=submittedDate&sortOrder=descending&max_results=${limit}`
  );
  // arXiv 標題常含換行與多餘空白，壓成單行。
  return parseRSS(xml, limit).map((it) => ({
    ...it,
    title: it.title.replace(/\s+/g, ' ').trim(),
    meta: 'arXiv',
  }));
}

// Dev.to 熱門技術文章（官方 JSON API）。
export async function fetchDevto(limit = 8) {
  const items = await getJSON(`https://dev.to/api/articles?top=1&per_page=${limit}`);
  return items.map((it) => ({
    title: it.title,
    url: it.url,
    meta: `♥ ${it.positive_reactions_count ?? 0}${
      it.tag_list?.length ? ` · ${it.tag_list.slice(0, 3).join(', ')}` : ''
    }`,
  }));
}

// 數位時代（bnext）無 RSS，僅提供 sitemap（純 URL）。
// 流程：sitemap index → 取最新 chunk → 取 ID 最大（最新）的數篇 → 各頁抓 og:title。
export async function fetchBnext(limit = 5) {
  const index = await getText('https://www.bnext.com.tw/feed/sitemap.xml');
  const chunks = [...index.matchAll(/article\/(\d+)\.xml/g)].map((m) => Number(m[1]));
  if (!chunks.length) return [];
  const lastChunk = Math.max(...chunks);
  const chunkXml = await getText(`https://www.bnext.com.tw/feed/article/${lastChunk}.xml`);
  const urls = [...chunkXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).slice(-limit);

  const items = await Promise.all(
    urls.map(async (url) => {
      try {
        const html = await getText(url);
        const title = (html.match(/<meta property="og:title" content="([^"]+)"/i) || [])[1];
        return title ? { title: title.trim(), url, meta: '數位時代' } : null;
      } catch {
        return null;
      }
    })
  );
  return items.filter(Boolean).reverse(); // 最新在前
}

// 解碼常見 HTML 實體（RSS link 常含 &amp;，markdown 連結需還原成 &）。
function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'");
}

// 極簡 RSS/Atom 解析：同時支援 <item>（RSS）與 <entry>（Atom），不依賴外部套件。
function parseRSS(xml, limit) {
  const items = [];
  const tag = /<entry[\s>]/i.test(xml) ? 'entry' : 'item';
  const blocks = xml.split(new RegExp(`<${tag}[\\s>]`, 'i')).slice(1);
  for (const block of blocks.slice(0, limit)) {
    const title = (block.match(/<title[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/is) || [])[1];
    // Atom 的 link 在屬性裡：<link href="..."/>；RSS 則在標籤內文。
    const link =
      (block.match(/<link[^>]*href=["']([^"']+)["']/i) || [])[1] ||
      (block.match(/<link>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/link>/is) || [])[1];
    if (title && link) {
      items.push({ title: decodeEntities(title.trim()), url: decodeEntities(link.trim()), meta: '' });
    }
  }
  return items;
}

const RSS_FEEDS = [
  { name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml' },
  { name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index' },
  { name: 'iThome', url: 'https://www.ithome.com.tw/rss' },
  { name: 'INSIDE', url: 'https://www.inside.com.tw/feed/rss' },
  { name: 'TechOrange', url: 'https://buzzorange.com/techorange/feed/' },
];

export async function fetchRSS(limit = 5) {
  const out = [];
  for (const feed of RSS_FEEDS) {
    try {
      const xml = await getText(feed.url);
      for (const it of parseRSS(xml, limit)) {
        out.push({ ...it, meta: feed.name });
      }
    } catch (err) {
      console.warn(`RSS 抓取失敗 (${feed.name}): ${err.message}`);
    }
  }
  return out;
}
