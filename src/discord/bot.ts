// Optional Discord interface for capture, notifications, and review.
// Consumes the notification_events bus, delivers nags with decision buttons,
// runs Marco as the front door in #inbox, and maps delegations to threads.
// The engine never depends on this: if Discord is down, UI + browser still work.

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type BaseMessageOptions,
  type ButtonInteraction,
  type Message,
  type ModalSubmitInteraction,
  type TextChannel,
} from "discord.js";
import type { Marco } from "../agents/marco.js";
import type { SembleopsConfig } from "../config/load.js";
import type { Delegation, DelegationStore } from "../engine/delegations.js";
import { MAX_LEVEL } from "../engine/nag.js";
import { transcribeAudio } from "../engine/transcribe.js";
import { openAiApiKeyAvailable } from "../runtime/openaiConfig.js";
import { sanitizeOutput } from "../shared/style.js";
import type { NotificationEvent, TaskStore } from "../engine/store.js";
import type { Task } from "../shared/types.js";

const POLL_MS = 10_000;
const SNOOZE_HOURS: Record<string, number> = { "1": 1, "3": 3, "18": 18 };
export interface DiscordBotDeps {
  store: TaskStore;
  delegations: DelegationStore;
  marco: Marco;
  config: SembleopsConfig;
  hubUrl: string;
}

export class SembleopsBot {
  private readonly client: Client;
  private inbox: TextChannel | null = null;
  private timer: NodeJS.Timeout | null = null;
  private readonly ownerId: string;
  private readonly snoozeCap: number;

  constructor(private readonly deps: DiscordBotDeps) {
    this.ownerId = process.env[deps.config.node.discord.owner_user_id_env] ?? "";
    this.snoozeCap = deps.config.node.nag.snooze_cap;
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });
  }

  async start(): Promise<boolean> {
    const token = process.env[this.deps.config.node.discord.token_env];
    if (!token || !this.ownerId) {
      console.log("discord: token/owner not configured — bot disabled, UI-only mode");
      return false;
    }

    this.client.on(Events.ClientReady, () => {
      this.resolveInbox();
      console.log(
        `discord: connected as ${this.client.user?.tag}, inbox=${this.inbox ? `#${this.inbox.name}` : "NOT FOUND (invite the bot to your server — it will attach automatically)"}`,
      );
      // Don't blast a stale backlog on first connect.
      const cutoff = new Date(Date.now() - 10 * 60_000).toISOString();
      const skipped = this.deps.store.skipStaleDiscordBacklog(cutoff);
      if (skipped > 0) console.log(`discord: skipped ${skipped} stale backlog notification(s)`);
      this.timer = setInterval(() => void this.pump(), POLL_MS);
      this.timer.unref();
      void this.pump();
    });

    // Bot invited (or channel created) after boot — attach without a restart.
    this.client.on(Events.GuildCreate, () => {
      this.resolveInbox();
      if (this.inbox) console.log(`discord: attached to #${this.inbox.name}`);
    });

    this.client.on(Events.MessageCreate, (m) => void this.onMessage(m).catch(console.error));
    this.client.on(Events.InteractionCreate, (i) => {
      if (i.isButton()) void this.onButton(i).catch(console.error);
      else if (i.isModalSubmit()) void this.onModal(i).catch(console.error);
    });
    this.client.on(Events.Error, (e) => console.error("discord:", e.message));

    await this.client.login(token);
    return true;
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    void this.client.destroy();
  }

  /** Message spoken by a specific agent: name, role, and persona-color stripe. */
  private agentMessage(
    slug: string,
    body: string,
    components: ActionRowBuilder<ButtonBuilder>[] = [],
  ): BaseMessageOptions {
    const persona = this.deps.config.personas[slug];
    if (!persona) return { content: this.clip(body), components };
    const embed = new EmbedBuilder()
      .setDescription(this.clip(body, 3500))
      .setColor(parseInt(persona.color.replace("#", ""), 16));
    embed.setAuthor({ name: `${persona.name} · ${persona.role}` });
    return { embeds: [embed], components };
  }

  private resolveInbox(): void {
    const guild = this.client.guilds.cache.first();
    const wanted = this.deps.config.node.discord.channel;
    const channel =
      guild?.channels.cache.find(
        (c) => c.type === ChannelType.GuildText && c.name === wanted,
      ) ?? guild?.channels.cache.find((c) => c.type === ChannelType.GuildText);
    this.inbox = (channel as TextChannel | undefined) ?? null;
  }

  // ---- Delivery pump: notification_events → Discord ----

  private async pump(): Promise<void> {
    if (!this.inbox) this.resolveInbox();
    if (!this.inbox) return;
    for (const event of this.deps.store.notificationsPendingDiscord()) {
      try {
        const messageId = await this.deliver(event);
        this.deps.store.markNotificationDiscordSent(event.id, messageId);
      } catch (err) {
        console.error(`discord: delivery failed for notification ${event.id}:`, err);
        return; // Retry next pump; do not mark an unconfirmed delivery as sent.
      }
    }
  }

  private async deliver(event: NotificationEvent): Promise<string | null> {
    if (!this.inbox) return null;

    // Delegation completions land in their thread when one exists.
    const delegationId = event.link_path.startsWith("/delegations/")
      ? event.link_path.slice("/delegations/".length)
      : null;
    if (delegationId) {
      const d = this.deps.delegations.get(delegationId);
      const target = d?.thread_id
        ? await this.inbox.threads.fetch(d.thread_id).catch(() => null)
        : null;
      const msg = await (target ?? this.inbox).send(this.agentMessage(event.agent, event.body));
      return msg.id;
    }

    // Task nags get decision buttons.
    const task = event.task_id ? this.deps.store.getTask(event.task_id) : undefined;
    if (event.kind === "nag" && task && task.status === "open") {
      const msg = await this.inbox.send(
        this.agentMessage(event.agent, event.body, [this.decisionRow(task, event.id)]),
      );
      return msg.id;
    }

    // Briefs, reckonings, blocked check-ins, everything else.
    const msg = await this.inbox.send(this.agentMessage(event.agent, event.body));
    return msg.id;
  }

  private decisionRow(task: Task, eventId: number): ActionRowBuilder<ButtonBuilder> {
    const forced = task.escalation_level >= MAX_LEVEL || task.snooze_count >= this.snoozeCap;
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`t:done:${task.id}:${eventId}`)
        .setLabel("Done")
        .setStyle(ButtonStyle.Success),
    );
    if (!forced) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`t:snoozepick:${task.id}:${eventId}`)
          .setLabel("Snooze")
          .setStyle(ButtonStyle.Secondary),
      );
    }
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`t:blocked:${task.id}:${eventId}`)
        .setLabel("Blocked")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`t:killpick:${task.id}:${eventId}`)
        .setLabel("Kill")
        .setStyle(ButtonStyle.Danger),
    );
    return row;
  }

  // ---- Buttons ----

  private async onButton(i: ButtonInteraction): Promise<void> {
    if (i.user.id !== this.ownerId) return void i.deferUpdate();
    const [ns, action, taskId, eventId] = i.customId.split(":");
    if (ns !== "t" || !action || !taskId) return void i.deferUpdate();

    if (action === "snoozepick") {
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        ...Object.keys(SNOOZE_HOURS).map((h) =>
          new ButtonBuilder()
            .setCustomId(`t:snooze${h}:${taskId}:${eventId}`)
            .setLabel(h === "18" ? "Tomorrow" : `${h}h`)
            .setStyle(ButtonStyle.Secondary),
        ),
        new ButtonBuilder().setCustomId(`t:back:${taskId}:${eventId}`).setLabel("Back").setStyle(ButtonStyle.Secondary),
      );
      return void i.update({ components: [row] });
    }

    if (action === "killpick") {
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`t:kill:${taskId}:${eventId}`).setLabel("Yes, kill it").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`t:back:${taskId}:${eventId}`).setLabel("Back").setStyle(ButtonStyle.Secondary),
      );
      return void i.update({ components: [row] });
    }

    if (action === "back") {
      const task = this.deps.store.getTask(taskId);
      if (!task || task.status !== "open") return void i.update({ components: [] });
      return void i.update({ components: [this.decisionRow(task, Number(eventId))] });
    }

    if (action === "blocked") {
      const modal = new ModalBuilder()
        .setCustomId(`m:blocked:${taskId}:${eventId}`)
        .setTitle("What is this blocked on?")
        .addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId("reason")
              .setLabel("Blocked reason")
              .setStyle(TextInputStyle.Short)
              .setRequired(true),
          ),
        );
      return void i.showModal(modal);
    }

    // Terminal decisions: done / kill / snooze<h>
    const task = this.deps.store.getTask(taskId);
    if (!task) return void i.update({ content: "That task no longer exists.", components: [] });

    let outcome = "";
    if (action === "done") {
      this.deps.store.applyDecision(task, { action: "done" }, this.snoozeCap, 0);
      outcome = "Done";
    } else if (action === "kill") {
      this.deps.store.applyDecision(task, { action: "kill" }, this.snoozeCap, 0);
      outcome = "Killed";
    } else if (action.startsWith("snooze")) {
      const hours = SNOOZE_HOURS[action.slice("snooze".length)] ?? 3;
      const res = this.deps.store.applyDecision(
        task,
        { action: "snooze", snooze_hours: hours },
        this.snoozeCap,
        this.deps.config.node.nag.blocked_recheck_hours,
      );
      outcome = res.ok
        ? `Snoozed ${hours === 18 ? "until tomorrow" : `${hours}h`} (${res.task.snooze_count}/${this.snoozeCap})`
        : res.error;
    } else {
      return void i.deferUpdate();
    }

    if (eventId) this.deps.store.markNotificationRead(Number(eventId));
    await i.update({
      content: `~~${task.title}~~\n${outcome} at ${new Date().toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`,
      components: [],
    });
  }

  private async onModal(i: ModalSubmitInteraction): Promise<void> {
    if (i.user.id !== this.ownerId) return;
    const [ns, action, taskId, eventId] = i.customId.split(":");
    if (ns !== "m" || action !== "blocked" || !taskId) return;
    const task = this.deps.store.getTask(taskId);
    if (!task) return void i.reply({ content: "That task no longer exists.", ephemeral: true });
    const reason = i.fields.getTextInputValue("reason");
    this.deps.store.applyDecision(
      task,
      { action: "blocked", reason },
      this.snoozeCap,
      this.deps.config.node.nag.blocked_recheck_hours,
    );
    if (eventId) this.deps.store.markNotificationRead(Number(eventId));
    if (i.isFromMessage()) {
      await i.update({ content: `~~${task.title}~~\nBlocked: ${reason}`, components: [] });
    } else {
      await i.reply({ content: `Blocked: ${reason}` });
    }
  }

  // ---- Marco front door + thread follow-ups ----

  private async onMessage(m: Message): Promise<void> {
    if (m.author.bot || m.author.id !== this.ownerId) return;

    // Follow-up inside a delegation thread → same agent, same thread, with context.
    if (m.channel.isThread()) {
      const prior = this.deps.delegations.byThreadId(m.channel.id);
      if (!prior) return;
      await m.react("⏳");
      const followUp = this.deps.delegations.enqueue(
        prior.agent,
        `Follow-up: ${prior.title}`,
        `Earlier task: ${prior.instructions}\n\nEarlier result:\n${(prior.result ?? prior.error ?? "(none)").slice(0, 4000)}\n\nUser follow-up:\n${m.content}`,
        prior.project,
      );
      this.deps.delegations.setThreadId(followUp.id, m.channel.id);
      await m.react("✅");
      return;
    }

    if (this.inbox && m.channelId !== this.inbox.id) return;

    // Voice messages: transcribe in memory (raw audio never hits disk), then
    // treat the transcript exactly like typed text.
    let text = m.content.trim();
    let fromVoice = false;
    const audio = m.attachments.find((a) => a.contentType?.startsWith("audio/"));
    if (audio) {
      if (!openAiApiKeyAvailable()) {
        await m.reply("Voice capture needs an OpenAI API key in the server environment. Text input is still available.");
        return;
      }
      await m.react("🎙️");
      const buf = Buffer.from(await (await fetch(audio.url)).arrayBuffer());
      const t = await transcribeAudio(buf, audio.contentType ?? "audio/ogg", audio.name ?? "voice.ogg");
      if (!t.ok || t.text.length === 0) {
        await m.reply(`Couldn't transcribe that: ${t.error ?? "empty transcript"}`);
        return;
      }
      text = t.text;
      fromVoice = true;
    }
    if (text.length === 0) return;

    // Status questions answered from the DB, not the LLM.
    if (/^(what('?s| is) (active|happening|going on)|status)\??$/i.test(text)) {
      await m.reply(this.agentMessage("marco", this.statusLine()));
      return;
    }

    await m.react("⏳");
    try {
      const res = await this.deps.marco.handle(text);
      const lines = [this.clip(res.reply, 500)];
      if (fromVoice) lines.unshift(`Heard: "${this.clip(text, 300)}"`);
      for (const a of res.actions) {
        lines.push(a.type === "commitment" ? `Larry: ${a.detail}` : `${a.agent}: ${a.title}`);
      }
      const reply = await m.reply(this.agentMessage("marco", lines.slice(0, 6).join("\n")));
      // One mission = one thread: every delegation from this routing reports
      // its completion inside the same thread instead of littering #inbox.
      const delegates = res.actions.filter((x) => x.type === "delegate");
      if (delegates.length > 0) {
        const thread = await reply
          .startThread({ name: this.clip(text, 90) })
          .catch(() => null);
        if (thread) {
          for (const a of delegates) this.deps.delegations.setThreadId(a.id, thread.id);
        }
      }
      await m.reactions.cache.get("⏳")?.remove().catch(() => {});
      await m.react("✅");
    } catch (err) {
      await m.reply(`Routing failed: ${(err as Error).message}`);
      await m.react("⚠️").catch(() => {});
    }
  }

  private statusLine(): string {
    const open = this.deps.store.listTasks(["open"]);
    const inbox = this.deps.store.inboxTasks().length;
    const running = this.deps.delegations.list(["queued", "running"]);
    const review = this.deps.delegations.list(["needs_review"]).length;
    const runningLine =
      running.length > 0
        ? running.map((d) => `${d.agent}: ${this.clip(d.title, 60)}`).join("\n")
        : "No agents running.";
    return [
      `${open.length} open commitment${open.length === 1 ? "" : "s"}, ${inbox} need a decision, ${review} run${review === 1 ? "" : "s"} to review.`,
      runningLine,
      `Hub: ${this.deps.hubUrl}`,
    ].join("\n");
  }

  private clip(text: string, max = 1800): string {
    const clean = sanitizeOutput(text);
    return clean.length > max ? clean.slice(0, max) + "..." : clean;
  }
}

/** Delegation-completion → notification bus (picked up by pump + browser bell). */
export function delegationFinishNotifier(store: TaskStore) {
  return (job: Delegation): void => {
    const ok = job.status === "needs_review";
    store.createNotification({
      task_id: null,
      kind: "other",
      agent: job.agent,
      title: ok ? `${job.agent} finished: ${job.title}` : `${job.agent} failed: ${job.title}`,
      body: ok
        ? `**${job.agent}** finished: ${job.title}\n${(job.result ?? "").slice(0, 400)}${(job.result?.length ?? 0) > 400 ? "…" : ""}\nReview it in the hub.`
        : `**${job.agent}** hit an error on: ${job.title}\n${job.error ?? "unknown"}`,
      link_path: `/delegations/${job.id}`,
    });
  };
}
