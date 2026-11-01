/** the args react-router hands a loader, action or middleware for a document
 * request: the request and its url. a document request carries no `.data`
 * suffix or `_routes`/`index` params, so its normalized url is its own. */
export const doc_args = (request: Request) => ({
  request,
  url: new URL(request.url),
});
