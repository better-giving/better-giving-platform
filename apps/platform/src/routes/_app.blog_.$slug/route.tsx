import { PortableText, type PortableTextComponents } from "@portabletext/react";
import { POST_QUERY } from "blog-types";
import { ChevronLeft } from "lucide-react";
import { href, Link, redirect } from "react-router";
import { post_path } from "#/api/get/posts";
import { sanity, urlFor } from "#/api/sanity";
import { pt_value } from "#/components/rich-text/pt-value";
import { app_name, base_url } from "#/constants/env";
import { metas } from "#/helpers/seo";
import { is_safe_href } from "@/helpers/safe-href";
import type { Route } from "./+types/route";
import { PostCta } from "./post-cta";

const container_style = "w-full px-5 max-w-4xl mx-auto pb-4";

const LAWSUIT_SLUG = "Fundraising-Platform Lawsuits";
const LAWSUIT_SLUG_CLEAN = "fundraising-platform-lawsuits";

export const loader = async ({ params }: Route.LoaderArgs) => {
  // 301 only once the renamed slug exists; until then the old url still renders
  if (params.slug === LAWSUIT_SLUG) {
    const renamed = await sanity.fetch(POST_QUERY, {
      slug: LAWSUIT_SLUG_CLEAN,
    });
    const to = post_path(LAWSUIT_SLUG_CLEAN);
    if (renamed && to) return redirect(to, { status: 301 });
  }

  const post = await sanity.fetch(POST_QUERY, { slug: params.slug });
  if (!post) throw new Response("Not Found", { status: 404 });
  return post;
};

export const headers: Route.HeadersFunction = () => ({
  "cache-control": "public, s-maxage=60, stale-while-revalidate=300",
});

export const meta: Route.MetaFunction = ({ loaderData: d }) => {
  if (!d) return [];
  // the loader matched this slug from a url, so it encodes
  const post_url = `${base_url}${post_path(d.slug.current)!}`;
  const image_url = urlFor(d.image)?.width(1200).height(630).url();

  const blog_posting: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: d.title,
    datePublished: d.publishedAt,
    mainEntityOfPage: { "@type": "WebPage", "@id": post_url },
    publisher: {
      "@type": "Organization",
      name: app_name,
      logo: { "@type": "ImageObject", url: `${base_url}/logo.png` },
    },
  };
  if (d.excerpt) blog_posting.description = d.excerpt;
  if (image_url) blog_posting.image = image_url;
  if (d._updatedAt) blog_posting.dateModified = d._updatedAt;
  if (d.author?.name)
    blog_posting.author = { "@type": "Person", name: d.author.name };

  const breadcrumbs = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: base_url },
      {
        "@type": "ListItem",
        position: 2,
        name: "Blog",
        item: `${base_url}/blog`,
      },
      { "@type": "ListItem", position: 3, name: d.title, item: post_url },
    ],
  };

  return metas({
    title: `${d.title} | Better Giving Blog`,
    description: d.excerpt || undefined,
    image: image_url,
    type: "article",
    url: post_url,
    jsonld: [blog_posting, breadcrumbs],
  });
};

export { ErrorBoundary } from "#/components/error";

const ptComponents: PortableTextComponents = {
  types: {
    image: ({ value }) => {
      const src = urlFor(value)?.width(900).url();
      return src ? (
        <figure className="my-6">
          <img src={src} alt={value.alt ?? ""} className="rounded" />
          {value.caption && (
            <figcaption className="mt-2 text-center text-sm text-gray-11">
              {value.caption}
            </figcaption>
          )}
        </figure>
      ) : null;
    },
  },
  marks: {
    // react blocks only `javascript:`; writes that bypass the studio's uri rule can store `data:`/`vbscript:`/any scheme
    link: ({ children, value }) =>
      is_safe_href(value?.href) ? (
        <a href={value.href}>{children}</a>
      ) : (
        children
      ),
  },
};

const day_ms = 24 * 60 * 60 * 1000;

export function updated_more_than_a_day_later(
  published_at: string,
  updated_at?: string | null
): boolean {
  if (!updated_at) return false;
  return (
    new Date(updated_at).getTime() - new Date(published_at).getTime() > day_ms
  );
}

function format_post_date(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export default function Post({ loaderData: post }: Route.ComponentProps) {
  const heroUrl = urlFor(post.image)?.width(900).height(500).url();
  return (
    <div className={container_style}>
      <Link
        to={href("/blog")}
        className="flex items-center gap-2 font-medium link mt-6"
      >
        <ChevronLeft className="text-[1em]" />
        <span>Go Back</span>
      </Link>
      {heroUrl ? (
        <img
          src={heroUrl}
          alt={post.image?.alt ?? ""}
          className="relative w-full aspect-9/5 object-cover object-top mt-4 rounded"
        />
      ) : (
        <div className="w-full aspect-9/5 mt-4 rounded bg-secondary" />
      )}
      <h1 className="text-xl md:text-2xl lg:text-3xl my-8 text-pretty">
        {post.title}
      </h1>

      <p className="text-sm mt-8 text-gray-11">
        Posted{" "}
        <time dateTime={post.publishedAt}>
          {format_post_date(post.publishedAt)}
        </time>
        {updated_more_than_a_day_later(post.publishedAt, post._updatedAt) && (
          <>
            {" · Updated "}
            <time dateTime={post._updatedAt}>
              {format_post_date(post._updatedAt)}
            </time>
          </>
        )}
      </p>
      {post.author?.name && (
        <p className="text-gray-11 text-sm">Author: {post.author.name}</p>
      )}
      <div className="w-full h-px bg-hairline my-4" />

      <div className="prose lg:prose-lg prose-a:text-primary hover:prose-a:text-primary">
        {Array.isArray(post.body) && (
          <PortableText
            value={pt_value(post.body, ptComponents)}
            components={ptComponents}
          />
        )}
      </div>

      {post.cta && <PostCta cta={post.cta} />}
    </div>
  );
}
