// GET from the services on the recording VM (the replay file server and the live relay). Both serve
// TLS with one self-signed certificate made on the VM; RELAY_CA is that certificate, and the only
// one trusted here, not any public authority. Global fetch can't take a CA (it needs undici), so
// this uses node:https. An http:// URL still works, for local testing and for the switch-over.
import http from "node:http";
import https from "node:https";
import { Readable } from "node:stream";
import type { ReadableStream } from "node:stream/web";

export function vmGet(url: string, token: string, signal?: AbortSignal): Promise<Response> {
  const u = new URL(url);
  const get = u.protocol === "https:" ? https.get : http.get;
  return new Promise((resolve, reject) => {
    const req = get(
      u,
      { ca: process.env.RELAY_CA, headers: { authorization: `Bearer ${token}` }, signal },
      (res) => {
        const body = Readable.toWeb(res) as ReadableStream<Uint8Array>;
        const type = res.headers["content-type"] ?? "application/octet-stream";
        resolve(new Response(body as globalThis.ReadableStream, { status: res.statusCode, headers: { "content-type": type } }));
      },
    );
    req.on("error", reject);
  });
}
