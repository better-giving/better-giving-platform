import type { LoaderFunction } from "react-router";

export const loader: LoaderFunction = async ({ url }) => {
  const base_url = url.origin;

  const robotText = `
# https://www.robotstxt.org/robotstxt.html
User-agent: *
Allow: /

# Security exclusions
Disallow: /admin/
Disallow: /dashboard/
Disallow: /platform/
Disallow: /api/

Sitemap: ${base_url}/sitemap.xml
`;

  return new Response(robotText.trim(), {
    status: 200,
    headers: {
      "content-type": "text/plain",
      "cache-control": "public, max-age=86400",
    },
  });
};
