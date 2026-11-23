// vmGet against a local TLS server with a self-signed certificate, made the way deploy.sh makes
// the VM's (openssl, ECDSA P-256, an IP as its name): trusted only when RELAY_CA is that certificate.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import https from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { vmGet } from "./vm.ts";

function makeCert(dir: string, name: string) {
  const [key, crt] = [join(dir, `${name}.key`), join(dir, `${name}.crt`)];
  execFileSync("openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256",
    "-nodes", "-days", "1", "-subj", "/CN=test", "-addext", "subjectAltName=IP:127.0.0.1",
    "-keyout", key, "-out", crt], { stdio: "ignore" });
  return { key: readFileSync(key, "utf8"), cert: readFileSync(crt, "utf8") };
}

test("trusts exactly the pinned certificate and sends the token", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vm-test-"));
  const vm = makeCert(dir, "vm");
  const other = makeCert(dir, "other");
  const server = https.createServer(vm, (req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ auth: req.headers.authorization }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `https://127.0.0.1:${(server.address() as AddressInfo).port}/index`;
  try {
    process.env.RELAY_CA = vm.cert;
    const res = await vmGet(url, "secret");
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/json");
    assert.deepEqual(await res.json(), { auth: "Bearer secret" });

    process.env.RELAY_CA = other.cert; // another self-signed certificate: refused
    await assert.rejects(vmGet(url, "secret"));
    delete process.env.RELAY_CA; // public authorities only: refused
    await assert.rejects(vmGet(url, "secret"));
  } finally {
    server.close();
  }
});
