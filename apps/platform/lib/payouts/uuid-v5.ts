// fixed namespace for the uuid v5 below; changing it re-keys every ref
const REF_NAMESPACE = Uint8Array.from(
  "cb853edef275466b85c79409fa3f037a".match(/../g)!,
  (h) => Number.parseInt(h, 16)
);

const rotl = (x: number, n: number) => (x << n) | (x >>> (32 - n));

/**
 * sha-1 of `msg`, in plain arithmetic: the refs below are made on the server,
 * but the code that makes them also loads where `node:crypto` and `Buffer` do
 * not exist (a browser test running a route's action against pglite), and
 * the web crypto digest is async while the refs are not
 */
export function sha1(msg: Uint8Array): Uint8Array {
  const bits = msg.length * 8;
  const padded = new Uint8Array(Math.ceil((msg.length + 9) / 64) * 64);
  padded.set(msg);
  padded[msg.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bits / 2 ** 32));
  view.setUint32(padded.length - 4, bits >>> 0);

  const h = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
  const w = new Array<number>(80);
  for (let i = 0; i < padded.length; i += 64) {
    for (let t = 0; t < 16; t++) w[t] = view.getUint32(i + t * 4);
    for (let t = 16; t < 80; t++) {
      w[t] = rotl(w[t - 3]! ^ w[t - 8]! ^ w[t - 14]! ^ w[t - 16]!, 1);
    }
    let [a, b, c, d, e] = h as [number, number, number, number, number];
    for (let t = 0; t < 80; t++) {
      const [f, k] =
        t < 20
          ? [(b & c) | (~b & d), 0x5a827999]
          : t < 40
            ? [b ^ c ^ d, 0x6ed9eba1]
            : t < 60
              ? [(b & c) | (b & d) | (c & d), 0x8f1bbcdc]
              : [b ^ c ^ d, 0xca62c1d6];
      const next = (rotl(a, 5) + f! + e + k! + w[t]!) | 0;
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a;
      a = next;
    }
    h[0] = (h[0]! + a) | 0;
    h[1] = (h[1]! + b) | 0;
    h[2] = (h[2]! + c) | 0;
    h[3] = (h[3]! + d) | 0;
    h[4] = (h[4]! + e) | 0;
  }
  const out = new Uint8Array(20);
  const out_view = new DataView(out.buffer);
  for (const [i, x] of h.entries()) out_view.setUint32(i * 4, x);
  return out;
}

/** the uuid v5 of `name` under the refs' namespace */
export function uuid_v5(name: string): string {
  const text = new TextEncoder().encode(name);
  const input = new Uint8Array(REF_NAMESPACE.length + text.length);
  input.set(REF_NAMESPACE);
  input.set(text, REF_NAMESPACE.length);
  const b = sha1(input).subarray(0, 16);
  b[6] = (b[6]! & 0x0f) | 0x50;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
