import { BaseAgent, createEvent, createEventActions } from "@google/adk";
import type { InvocationContext, Event } from "@google/adk";
import { resolve } from "node:path";
import { assembleSketch } from "../modules/assembler.js";
import { writeSketch } from "../processing/sketch-writer.js";
import { launchSketch } from "../processing/sketch-runner.js";
import type { ModuleConfigs } from "./mood-parameter-agent.js";

const MODULES_DIR = resolve("modules");

export class AssemblerAgent extends BaseAgent {
  constructor() {
    super({
      name: "assembler",
      description:
        "Fills module PDE templates with configured parameters and launches the assembled Processing sketch.",
    });
  }

  protected async *runAsyncImpl(ctx: InvocationContext): AsyncGenerator<Event, void, void> {
    const configs       = ctx.session.state["app:moduleConfigs"]  as ModuleConfigs | undefined;
    const inputMode     = ctx.session.state["app:audioInputMode"] as string | undefined;
    const mp3Path       = ctx.session.state["app:mp3Path"]        as string | undefined;
    const activeModules = ctx.session.state["app:activeModules"]  as string[] | undefined;

    if (!configs) {
      yield createEvent({
        author: this.name,
        content: { role: "model", parts: [{ text: "[assembler] No moduleConfigs in state — skipping." }] },
        actions: createEventActions(),
      });
      return;
    }

    const moduleIds = activeModules ?? Object.keys(configs);
    const liveInput = inputMode === "blackhole";

    console.log(`[AssemblerAgent] Assembling [${moduleIds.join(", ")}] (${liveInput ? "live" : "file"})`);

    try {
      const { code } = assembleSketch({
        moduleIds,
        configs,
        modulesDir: MODULES_DIR,
        liveInput,
        ...(mp3Path !== undefined ? { mp3Path } : {}),
      });

      const sketch = await writeSketch(code);
      launchSketch(sketch);

      console.log(`[AssemblerAgent] Launched → ${sketch.file}`);

      yield createEvent({
        author: this.name,
        actions: createEventActions({ stateDelta: { sketchPath: sketch.file } }),
        content: {
          role: "model",
          parts: [{ text: `Sketch launched → ${sketch.file}` }],
        },
      });
    } catch (err) {
      yield createEvent({
        author: this.name,
        content: { role: "model", parts: [{ text: `[assembler] Error: ${err}` }] },
        actions: createEventActions(),
      });
    }
  }

  protected async *runLiveImpl(_ctx: InvocationContext): AsyncGenerator<Event, void, void> {
    throw new Error("AssemblerAgent does not support live mode");
  }
}
