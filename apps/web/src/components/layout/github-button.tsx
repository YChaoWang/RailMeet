import Link from 'next/link';
import { Suspense } from 'react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { formatGithubStarCount } from '@/lib/format-github-star-count';

const GITHUB_OWNER = 'YChaoWang';
const GITHUB_REPO = 'RailMeet';
const GITHUB_REPO_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}`;

function GitHubMark({ className }: { readonly className?: string }) {
  return (
    <svg viewBox="0 0 1024 1024" fill="currentColor" className={className} aria-hidden>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M8 0C3.58 0 0 3.58 0 8C0 11.54 2.29 14.53 5.47 15.59C5.87 15.66 6.02 15.42 6.02 15.21C6.02 15.02 6.01 14.39 6.01 13.72C4 14.09 3.48 13.23 3.32 12.78C3.23 12.55 2.84 11.84 2.5 11.65C2.22 11.5 1.82 11.13 2.49 11.12C3.12 11.11 3.57 11.7 3.72 11.94C4.44 13.15 5.59 12.81 6.05 12.6C6.12 12.08 6.33 11.73 6.56 11.53C4.78 11.33 2.92 10.64 2.92 7.58C2.92 6.71 3.23 5.99 3.74 5.43C3.66 5.23 3.38 4.41 3.82 3.31C3.82 3.31 4.49 3.1 6.02 4.13C6.66 3.95 7.34 3.86 8.02 3.86C8.7 3.86 9.38 3.95 10.02 4.13C11.55 3.09 12.22 3.31 12.22 3.31C12.66 4.41 12.38 5.23 12.3 5.43C12.81 5.99 13.12 6.7 13.12 7.58C13.12 10.65 11.25 11.33 9.47 11.53C9.76 11.78 10.01 12.26 10.01 13.01C10.01 14.08 10 14.94 10 15.21C10 15.42 10.15 15.67 10.55 15.59C13.71 14.53 16 11.53 16 8C16 3.58 12.42 0 8 0Z"
        transform="scale(64)"
        fill="currentColor"
      />
    </svg>
  );
}

export async function GithubStarCount() {
  try {
    const response = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'RailMeet',
      },
      next: { revalidate: 60 },
    });
    if (!response.ok) {
      return null;
    }
    const data = (await response.json()) as { stargazers_count?: unknown };
    if (typeof data.stargazers_count !== 'number' || data.stargazers_count < 1) {
      return null;
    }
    return (
      <span className="pt-0.5 text-xs tabular-nums text-ink-700 dark:text-mist-50/60">
        {formatGithubStarCount(data.stargazers_count)}
      </span>
    );
  } catch {
    return null;
  }
}

export function GithubButton({ withCount = true }: { readonly withCount?: boolean }) {
  return (
    <Button variant="ghost" size="sm" asChild className="min-h-11 gap-1.5 px-2.5">
      <Link
        href={GITHUB_REPO_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="RailMeet on GitHub (open source)"
        data-testid="site-header-github"
      >
        <GitHubMark className="size-4" />
        {withCount ? (
          <Suspense fallback={<Skeleton className="h-4 w-6 rounded dark:bg-white/10" />}>
            <GithubStarCount />
          </Suspense>
        ) : null}
      </Link>
    </Button>
  );
}
