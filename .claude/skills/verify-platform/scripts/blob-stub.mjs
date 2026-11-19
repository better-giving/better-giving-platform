// verification scaffolding. while BLOB_READ_WRITE_TOKEN is .env.test filler,
// @vercel/blob put() talks to this process instead of vercel.com. the sdk
// reads VERCEL_BLOB_API_URL at request time. a real token leaves that unset.
// every stubbed call is logged to $VERIFY_STATE/blob-stub.log.
//
// a private put (`x-vercel-blob-access: private`, what documents use) is
// answered with a url on this server, and a GET of that url returns a tiny pdf
// whatever the pathname: it is what the app's document route reads back.
import fs from "node:fs";
import http from "node:http";

const token = process.env.BLOB_READ_WRITE_TOKEN ?? "";
const filler = !token || token.includes("test-only");
if (filler && !globalThis.__verify_blob) {
  globalThis.__verify_blob = true;
  const log = `${process.env.VERIFY_STATE ?? "/tmp/bg-verify"}/blob-stub.log`;
  const port = process.env.VERIFY_PORT ?? "4200";
  const public_url = `http://127.0.0.1:${port}/logo.png`;
  const pdf = "%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n";
  let origin = "";
  const srv = http.createServer((q, r) => {
    const pathname = new URL(q.url ?? "/", "http://127.0.0.1").searchParams.get(
      "pathname"
    );
    const is_private = q.headers["x-vercel-blob-access"] === "private";
    try {
      fs.appendFileSync(
        log,
        `${new Date().toISOString()} ${q.method} ${q.url}${is_private ? " (private)" : ""} → 200\n`
      );
    } catch {}
    q.resume();
    q.on("end", () => {
      if (q.method === "GET" || q.method === "HEAD") {
        r.writeHead(200, {
          "content-type": "application/pdf",
          "content-length": Buffer.byteLength(pdf),
          etag: '"verify"',
        });
        r.end(q.method === "HEAD" ? undefined : pdf);
        return;
      }
      const url = is_private
        ? `${origin}/${pathname ?? "docs/upload.pdf"}`
        : public_url;
      r.writeHead(200, { "content-type": "application/json" });
      r.end(
        JSON.stringify({
          url,
          downloadUrl: `${url}?download=1`,
          pathname: pathname ?? "u/upload.png",
          contentType: is_private ? "application/pdf" : "image/png",
          contentDisposition: "inline",
          etag: "verify",
        })
      );
    });
  });
  await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
  srv.unref();
  origin = `http://127.0.0.1:${srv.address().port}`;
  process.env.VERCEL_BLOB_API_URL = origin;
  console.error(`[blob-stub] vercel blob → ${origin} (filler token)`);
}
