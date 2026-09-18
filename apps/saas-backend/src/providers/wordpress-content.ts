// WordPress content bridge — fetches live site content from the host site's
// WordPress REST API. The AgentCore's content tools (search_posts / get_post)
// call this when a session carries a site_url; otherwise the mock provider is
// used so the pipeline still works offline.

import type {
  ContentPost,
  ContentSearchResult,
  ContentToolProvider,
} from '@ai-platform/agent-core';

/** Max time to wait for a WP REST response before giving up. */
const WP_TIMEOUT_MS = 8000;

/** Strip HTML tags and decode common entities from a WP `rendered` field. */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

interface WpPostSummary {
  id: number;
  title: { rendered: string };
  excerpt: { rendered: string };
  link: string;
}

interface WpPostFull extends WpPostSummary {
  content: { rendered: string };
}

function baseUrl(siteUrl: string): string {
  return siteUrl.replace(/\/+$/, '');
}

/**
 * Content bridge that talks to a live WordPress site's REST API.
 * The site origin is passed per call: one instance serves all tenants, and each
 * session carries its own site_url (multi-tenant).
 */
export class WordPressContentToolProvider implements ContentToolProvider {
  async searchPosts(query: string, siteUrl?: string): Promise<ContentSearchResult> {
    if (!siteUrl) return { posts: [] };
    const params = new URLSearchParams({
      per_page: '5',
      _fields: 'id,title,excerpt,link',
    });
    const search = query.trim();
    if (search) params.set('search', search);
    const url = `${baseUrl(siteUrl)}/wp-json/wp/v2/posts?${params.toString()}`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(WP_TIMEOUT_MS) });
      if (!res.ok) return { posts: [] };
      const data = (await res.json()) as WpPostSummary[];
      return {
        posts: data.map((p) => ({
          id: String(p.id),
          title: stripHtml(p.title.rendered),
          excerpt: stripHtml(p.excerpt.rendered),
          content: '',
          url: p.link,
        })),
      };
    } catch {
      return { posts: [] };
    }
  }

  async getPost(postId: string, siteUrl?: string): Promise<ContentPost | null> {
    if (!siteUrl) return null;
    const url =
      `${baseUrl(siteUrl)}/wp-json/wp/v2/posts/${encodeURIComponent(postId)}` +
      `?_fields=id,title,excerpt,content,link`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(WP_TIMEOUT_MS) });
      if (!res.ok) return null;
      const p = (await res.json()) as WpPostFull;
      return {
        id: String(p.id),
        title: stripHtml(p.title.rendered),
        excerpt: stripHtml(p.excerpt.rendered),
        content: stripHtml(p.content.rendered),
        url: p.link,
      };
    } catch {
      return null;
    }
  }
}

/**
 * Composite content bridge: uses the live WordPress REST API when the session
 * carries a site_url, otherwise falls back to the mock provider (offline dev).
 */
export class ContentBridge implements ContentToolProvider {
  constructor(
    private readonly wp: WordPressContentToolProvider,
    private readonly fallback: ContentToolProvider,
  ) {}

  async searchPosts(query: string, siteUrl?: string): Promise<ContentSearchResult> {
    if (siteUrl) return this.wp.searchPosts(query, siteUrl);
    return this.fallback.searchPosts(query);
  }

  async getPost(postId: string, siteUrl?: string): Promise<ContentPost | null> {
    if (siteUrl) return this.wp.getPost(postId, siteUrl);
    return this.fallback.getPost(postId);
  }
}
