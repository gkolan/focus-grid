/**
 * Assistant agent tool contract. Shared client + server, no secrets.
 * The model runs on the server (with web search); every data tool below is
 * executed in the browser against the local FocusGridApp, so the server never
 * touches task data. Inputs are model output — validated here before use.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const taskFields = {
  title: z.string().min(1).max(2000),
  notes: z.string().max(20_000).optional(),
  /** date-only deadline (YYYY-MM-DD, in the user's time zone) */
  deadlineDate: z.string().regex(DATE).optional(),
  /** exact deadline instant, UTC ISO 8601 */
  deadlineAt: z.string().regex(ISO_Z).optional(),
  /** when the task/event starts, UTC ISO 8601 — use with estimatedMinutes for an event */
  startAt: z.string().regex(ISO_Z).nullable().optional(),
  estimatedMinutes: z.number().int().min(1).max(525_600).nullable().optional(),
  contextName: z.string().max(100).nullable().optional(),
  importance: z.enum(["low", "medium", "high"]).optional(),
  tags: z.array(z.string().min(1).max(50)).max(20).optional(),
};

export const toolInputSchemas = {
  list_tasks: z.object({ status: z.enum(["open", "completed", "all"]).default("open"), search: z.string().max(200).optional() }).strict(),
  create_task: z.object(taskFields).strict(),
  update_task: z.object(taskFields).partial().extend({ id: z.string() }).strict(),
  complete_task: z.object({ id: z.string() }).strict(),
  list_calendar_feeds: z.object({}).strict(),
  add_calendar_feed: z.object({ name: z.string().min(1).max(100), url: z.string().url() }).strict(),
  remove_calendar_feed: z.object({ id: z.string() }).strict(),
} as const;

export type ToolName = keyof typeof toolInputSchemas;

const D = "Dates: startAt/deadlineAt are UTC ISO 8601; deadlineDate is a local calendar date (YYYY-MM-DD).";

/** Anthropic tool definitions (JSON Schema hand-written to stay strict and small). */
export const AGENT_TOOLS: Anthropic.Tool[] = [
  {
    name: "list_tasks",
    description: "List the user's tasks with ids, revisions, dates and context. Call before updating or completing anything.",
    input_schema: { type: "object", properties: { status: { type: "string", enum: ["open", "completed", "all"] }, search: { type: "string" } }, additionalProperties: false },
  },
  {
    name: "create_task",
    description: `Create a task. An event/appointment is a task with startAt and estimatedMinutes. ${D} contextName must be one of the user's contexts, or null.`,
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        notes: { type: "string" },
        deadlineDate: { type: "string" },
        deadlineAt: { type: "string" },
        startAt: { type: ["string", "null"] },
        estimatedMinutes: { type: ["integer", "null"] },
        contextName: { type: ["string", "null"] },
        importance: { type: "string", enum: ["low", "medium", "high"] },
        tags: { type: "array", items: { type: "string" } },
      },
      required: ["title"],
      additionalProperties: false,
    },
  },
  {
    name: "update_task",
    description: `Change fields on an existing task (id from list_tasks). Only send fields that change. ${D}`,
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        notes: { type: "string" },
        deadlineDate: { type: "string" },
        deadlineAt: { type: "string" },
        startAt: { type: ["string", "null"] },
        estimatedMinutes: { type: ["integer", "null"] },
        contextName: { type: ["string", "null"] },
        importance: { type: "string", enum: ["low", "medium", "high"] },
        tags: { type: "array", items: { type: "string" } },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "complete_task",
    description: "Mark a task done (id from list_tasks).",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false },
  },
  {
    name: "list_calendar_feeds",
    description: "List subscribed public calendar feeds (read-only overlays on the calendar).",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "add_calendar_feed",
    description:
      "Subscribe to a public iCalendar (.ics / webcal://) feed such as a sports team's fixtures or a holiday calendar. Use web_search to find the feed URL first. The feed is fetched and verified; on failure try another URL.",
    input_schema: { type: "object", properties: { name: { type: "string" }, url: { type: "string" } }, required: ["name", "url"], additionalProperties: false },
  },
  {
    name: "remove_calendar_feed",
    description: "Unsubscribe from a calendar feed (id from list_calendar_feeds).",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false },
  },
];

/** Per-request client context the browser sends; rendered into the system prompt after the stable prefix. */
export const agentContextSchema = z
  .object({
    now: z.string().regex(ISO_Z),
    timeZone: z.string().max(80),
    contexts: z.array(z.string().max(100)).max(60),
    feeds: z.array(z.object({ name: z.string().max(100), url: z.string().max(500) }).strict()).max(20),
  })
  .strict();
export type AgentContext = z.infer<typeof agentContextSchema>;

export const MAX_AGENT_REQUEST_BYTES = 512 * 1024;
