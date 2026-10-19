import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readStringArrayParam, readStringParam } from "./common.js";

/**
 * Your own drawer of files.
 *
 * Everything you have been given and everything you have made is kept against
 * you, and the person you work with sees it beside your conversation. The
 * folders are yours to invent — nobody has decided in advance what the
 * categories are, because a fixed set would be wrong by the second week.
 *
 * Filing is a small courtesy that costs nothing and makes the drawer worth
 * opening. A heap of files called Unsorted is the same as no drawer at all.
 */

const FilesToolSchema = Type.Object({
  /** "list" to see the drawer, "file" to put things in a folder, "rename_folder" to rename one. */
  action: Type.String(),
  /** file: which files, by id, from a list. */
  fileIds: Type.Optional(Type.Array(Type.String())),
  /** file: the folder to put them in. Invent one that describes the work. */
  folder: Type.Optional(Type.String()),
  /** file: a short line saying what this is, for someone scanning the drawer. */
  label: Type.Optional(Type.String()),
  /** rename_folder: the folder as it is now. */
  from: Type.Optional(Type.String()),
  /** rename_folder: what it should be called. */
  to: Type.Optional(Type.String()),
});

export function createFilesTool(opts?: { agentId?: string }): AnyAgentTool {
  return {
    label: "Files",
    name: "files",
    description: [
      "Your files: everything you have been given and everything you have made. The person you work with sees this beside your conversation.",
      'action="list" shows the drawer. action="file" moves files into a folder and gives them a label: pass fileIds, a folder, and a short label saying what each is. action="rename_folder" renames one.',
      "The folders are yours to name. Pick something that describes the work — \"Trailers\", \"Client uploads\", \"Q3 report\" — not the file type, which is already obvious from the file.",
      "File things when you make or receive something worth finding again, without being asked. Anything left in Unsorted is a drawer nobody can use. Do not announce that you filed something; it is housekeeping, not news.",
    ].join(" "),
    parameters: FilesToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action") ?? "list";

      const base = process.env.TABHR_API_BASE_URL?.trim().replace(/\/+$/, "");
      const auth = process.env.OPENCLAW_GATEWAY_TOKEN?.trim();
      const agentId = opts?.agentId ?? "";
      if (!base || !auth || !agentId) {
        return jsonResult({ ok: false, error: "Files are not available here." });
      }

      try {
        const res = await fetch(`${base}/api/agent/files`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth}` },
          body: JSON.stringify({
            agentId,
            action,
            fileIds: readStringArrayParam(params, "fileIds") ?? undefined,
            folder: readStringParam(params, "folder") ?? undefined,
            label: readStringParam(params, "label") ?? undefined,
            from: readStringParam(params, "from") ?? undefined,
            to: readStringParam(params, "to") ?? undefined,
          }),
          signal: AbortSignal.timeout(30_000),
        });
        const data = await res.json();
        if (!res.ok) return jsonResult({ ok: false, error: data.error || `Files ${res.status}` });
        return jsonResult({ ok: true, ...data });
      } catch (err) {
        return jsonResult({ ok: false, error: `Could not reach TabHR: ${(err as Error).message}` });
      }
    },
  };
}
