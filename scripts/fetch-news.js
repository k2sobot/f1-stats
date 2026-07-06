#!/usr/bin/env node
/**
 * Fetch F1 news from RSS feeds and save to JSON
 * Runs daily via GitHub Actions
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// RSS feed sources
const FEEDS = [
  {
    name: 'BBC Sport F1',
    url: 'https://feeds.bbci.co.uk/sport/formula1/rss.xml',
    type: 'rss'
  },
  {
    name: 'ESPN F1',
    url: 'https://www.espn.com/espn/rss/rpm/news',
    type: 'rss',
    filter: 'f1' // Filter for F1 articles only
  }
];

// Fetch URL content
function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: { 'User-Agent': 'simplef1stats-bot/1.0' }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
      res.on('error', reject);
    }).on('error', reject);
  });
}

// Clean CDATA and entities from text
function cleanText(text) {
  if (!text) return '';
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim();
}

// Parse RSS XML to items
function parseRSS(xml, source) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match;
  
  while ((match = itemRegex.exec(xml)) !== null) {
    const itemXml = match[1];
    
    const titleMatch = itemXml.match(/<title>([\s\S]*?)<\/title>/i);
    const linkMatch = itemXml.match(/<link>([\s\S]*?)<\/link>/i);
    const descMatch = itemXml.match(/<description>([\s\S]*?)<\/description>/i);
    const dateMatch = itemXml.match(/<pubDate>([\s\S]*?)<\/pubDate>/i);
    
    if (titleMatch && linkMatch) {
      const title = cleanText(titleMatch[1]);
      const link = cleanText(linkMatch[1].split('&')[0]); // Clean tracking params
      const description = cleanText(descMatch ? descMatch[1] : '');
      const pubDate = cleanText(dateMatch ? dateMatch[1] : '');
      
      // Filter ESPN to F1 articles only
      if (source.filter && !link.includes('/f1/')) continue;
      
      items.push({
        title,
        link,
        description: description.replace(/<[^>]+>/g, '').substring(0, 200),
        pubDate,
        source: source.name
      });
    }
  }
  
  return items;
}

// Main
async function main() {
  console.log('Fetching F1 news...');
  const allNews = [];
  
  for (const feed of FEEDS) {
    try {
      console.log(`Fetching ${feed.name}...`);
      const xml = await fetch(feed.url);
      const items = parseRSS(xml, feed);
      console.log(`  Found ${items.length} articles`);
      allNews.push(...items);
    } catch (err) {
      console.error(`Error fetching ${feed.name}:`, err.message);
    }
  }
  
  // Sort by date (newest first)
  allNews.sort((a, b) => {
    const dateA = new Date(a.pubDate);
    const dateB = new Date(b.pubDate);
    return dateB - dateA;
  });
  
  // Keep top 20
  const news = allNews.slice(0, 20);
  
  // Add metadata
  const output = {
    lastUpdated: new Date().toISOString(),
    total: news.length,
    articles: news
  };
  
  // Ensure data directory exists
  const dataDir = path.join(__dirname, '..', 'docs', 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  
  // Write JSON
  const outputPath = path.join(dataDir, 'news.json');
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`Saved ${news.length} articles to ${outputPath}`);
}

main().catch(console.error);
