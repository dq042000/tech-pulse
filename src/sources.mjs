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

// GitHub 近一週新建、星數最高的 repo（用 Search API，免額外金鑰；
// Actions 環境會帶 GITHUB_TOKEN 以提高速率上限）。
export async function fetchGitHubTrending(limit = 10) {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const headers = { Accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const data = await getJSON(
    `https://api.github.com/search/repositories?q=created:>${since}&sort=stars&order=desc&per_page=${limit}`,
    headers
  );
  return (data.items || []).map((repo) => ({
    title: `${repo.full_name}${repo.language ? ` (${repo.language})` : ''}`,
    url: repo.html_url,
    meta: `★ ${repo.stargazers_count} · ${repo.description || '（無描述）'}`.slice(0, 160),
  }));
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
    if (title && link) items.push({ title: title.trim(), url: link.trim(), meta: '' });
  }
  return items;
}

const RSS_FEEDS = [
  { name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml' },
  { name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index' },
  { name: 'iThome', url: 'https://www.ithome.com.tw/rss' },
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
