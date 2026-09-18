// Mock content tool provider — deterministic site content for offline development.

import type {
  ContentPost,
  ContentSearchResult,
  ContentToolProvider,
} from '@ai-platform/agent-core';

const POSTS: ContentPost[] = [
  {
    id: 'post-1',
    title: 'Welcome to our studio',
    excerpt: 'Who we are and what we do.',
    content: 'We are a small design studio focused on thoughtful digital products.',
    url: 'https://example.com/welcome',
  },
  {
    id: 'post-2',
    title: 'Our pricing',
    excerpt: 'Simple, transparent plans.',
    content: 'Plans start at a free tier and scale with usage. No hidden fees.',
    url: 'https://example.com/pricing',
  },
  {
    id: 'post-3',
    title: 'How to get in touch',
    excerpt: 'Contact and support.',
    content:
      'Reach us by email or through the contact form. We reply within one business day.',
    url: 'https://example.com/contact',
  },
];

export class MockContentToolProvider implements ContentToolProvider {
  async searchPosts(query: string, _siteUrl?: string): Promise<ContentSearchResult> {
    const q = query.trim().toLowerCase();
    const posts = q
      ? POSTS.filter(
          (p) =>
            p.title.toLowerCase().includes(q) ||
            p.excerpt.toLowerCase().includes(q) ||
            p.content.toLowerCase().includes(q),
        )
      : POSTS;
    return { posts };
  }

  async getPost(postId: string, _siteUrl?: string): Promise<ContentPost | null> {
    return POSTS.find((p) => p.id === postId) ?? null;
  }
}
