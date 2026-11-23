// The VM's file server for replays and event responses (recorder/cmd/replayserve). Only this
// server knows REPLAY_TOKEN; the browser never talks to it. TLS with the VM's pinned certificate.
import { vmGet } from "./vm.ts";

export async function fetchReplay(path: string): Promise<Response> {
  const url = process.env.REPLAY_URL;
  const token = process.env.REPLAY_TOKEN;
  if (!url || !token) throw new Error("REPLAY_URL / REPLAY_TOKEN are not set");
  const res = await vmGet(`${url}${path}`, token, AbortSignal.timeout(20_000));
  if (!res.ok) throw new Error(`replay server: ${path}: ${res.status}`);
  return res;
}
