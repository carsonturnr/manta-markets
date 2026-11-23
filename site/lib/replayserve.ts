// The VM's file server for replays and event responses (recorder/cmd/replayserve). Only this
// server knows REPLAY_TOKEN; the browser never talks to it.
export async function fetchReplay(path: string): Promise<Response> {
  const url = process.env.REPLAY_URL;
  const token = process.env.REPLAY_TOKEN;
  if (!url || !token) throw new Error("REPLAY_URL / REPLAY_TOKEN are not set");
  const res = await fetch(`${url}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store", // callers cache with "use cache"; the token stays out of fetch's cache key
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`replay server: ${path}: ${res.status}`);
  return res;
}
