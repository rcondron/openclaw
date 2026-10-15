import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readNumberParam, readStringParam } from "./common.js";

/**
 * Make a video.
 *
 * The work happens on the TabHR host: it plans the shots, renders each one on
 * Google Veo and joins them up. The agent asks and waits, the same arrangement
 * as a browser run and for the same reason — the key stays off the container.
 *
 * Veo will not make anything longer than eight seconds, so a minute is eight
 * separate generations by a model that sees one shot at a time. That is why
 * this takes minutes, and why the brief matters: the plan is the only thing
 * keeping the shots looking like one piece.
 */

const DEFAULT_DEADLINE_MS = 15 * 60 * 1000;
const POLL_MS = 10_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const VideoToolSchema = Type.Object({
  /** What it should show. Turned into shots by the planner. */
  brief: Type.String(),
  /** Roughly how long. Default 60, rounded to whole shots of 4-8 seconds. */
  seconds: Type.Optional(Type.Number()),
  /** "lite" for a draft, "fast" for normal, "standard" when it matters. */
  quality: Type.Optional(Type.String()),
});

export function createVideoTool(opts?: { agentId?: string }): AnyAgentTool {
  return {
    label: "Video",
    name: "video",
    description: [
      "Make a video from a description. Give a brief and it plans the shots, generates each one and returns a finished file with sound.",
      "It takes several minutes, because a minute of video is eight separate generations. Tell the person you are making it BEFORE you call this, and never call it twice for the same request.",
      'The reply carries a url when it works: give that url to the person, it is how they watch it. When ok is false, say what the error says and do not retry.',
      "Describe what should be SEEN — who, where, the mood, the camera. Anything written on screen comes out as gibberish, so never ask for captions, titles, subtitles or logos.",
    ].join(" "),
    parameters: VideoToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const brief = readStringParam(params, "brief", { required: true })!;
      const seconds = readNumberParam(params, "seconds") ?? undefined;
      const quality = readStringParam(params, "quality") ?? undefined;

      const base = process.env.TABHR_API_BASE_URL?.trim().replace(/\/+$/, "");
      const auth = process.env.OPENCLAW_GATEWAY_TOKEN?.trim();
      const agentId = opts?.agentId ?? "";

      if (!base || !auth || !agentId) {
        console.log("[video] cannot run: TABHR_API_BASE_URL, OPENCLAW_GATEWAY_TOKEN and an agent id are all required");
        return jsonResult({ ok: false, error: "Video generation is not available here." });
      }

      const headers = { "Content-Type": "application/json", Authorization: `Bearer ${auth}` };

      let jobId: string;
      try {
        const res = await fetch(`${base}/api/agent/video`, {
          method: "POST",
          headers,
          body: JSON.stringify({ agentId, brief, seconds, quality }),
          signal: AbortSignal.timeout(60_000),
        });
        const data = (await res.json()) as { jobId?: string; error?: string };
        if (!res.ok || !data.jobId) {
          return jsonResult({ ok: false, error: data.error || `Could not start the video (${res.status})` });
        }
        jobId = data.jobId;
        console.log(`[video] job ${jobId} started for ${agentId}`);
      } catch (err) {
        return jsonResult({ ok: false, error: `Could not reach TabHR: ${(err as Error).message}` });
      }

      const deadline = Date.now() + DEFAULT_DEADLINE_MS;
      const statusUrl =
        `${base}/api/agent/video/${encodeURIComponent(jobId)}?agentId=${encodeURIComponent(agentId)}`;

      while (Date.now() < deadline) {
        await sleep(POLL_MS);
        let state: {
          done?: boolean;
          status?: string;
          title?: string | null;
          url?: string | null;
          error?: string | null;
          elapsedSeconds?: number;
          shotsDone?: number;
          shotsTotal?: number;
        };
        try {
          const res = await fetch(statusUrl, { headers, signal: AbortSignal.timeout(30_000) });
          if (!res.ok) continue;
          state = await res.json();
        } catch {
          // A missed poll says nothing; the next one will.
          continue;
        }

        if (!state.done) {
          console.log(`[video] ${jobId} ${state.status} ${state.shotsDone ?? 0}/${state.shotsTotal ?? 0}`);
          continue;
        }

        if (state.status === "done" && state.url) {
          console.log(`[video] ${jobId} finished in ${state.elapsedSeconds}s`);
          return jsonResult({ ok: true, title: state.title, url: state.url, tookSeconds: state.elapsedSeconds });
        }
        return jsonResult({ ok: false, error: state.error || "The video could not be made." });
      }

      return jsonResult({
        ok: false,
        error: "Still rendering after fifteen minutes. It may yet finish — do not start another.",
      });
    },
  };
}
