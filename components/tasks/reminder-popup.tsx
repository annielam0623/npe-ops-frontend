"use client";

import { useEffect, useRef, useState } from "react";

import type { DailyTask } from "@/types";

import { dueStatus } from "./config";

interface Reminder {
  taskId: number;
  title: string;
  text: string;
}

/** 短提示音：Web Audio 现拼一声，不用额外的音频文件（D2「弹窗 + 响声」）。 */
function beep() {
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.55);
  } catch {
    // 浏览器不让自动放声音（没有用户交互过）时安静跳过，弹窗本身照常显示。
  }
}

/**
 * 截止提醒（D2）：到期前 30 分钟一次，到点未完成再一次。弹窗 + 响声；
 * 同一时刻的邮件由后端发（任务包第 22 条），前端只做提醒触发和展示。
 */
export function ReminderPopup({
  tasks,
  now,
}: {
  tasks: DailyTask[];
  now: string;
}) {
  const [visible, setVisible] = useState<Reminder[]>([]);
  // 每个任务两个阶段各只响一次：避免同一阶段每次 tick 都重新弹。
  const firedRef = useRef(new Set<string>());
  // 弹窗刚出现时闪 3 下再定格（Annie 2026-10-19：「选B，然后可以制造一点声响或者震动一下么」「或者bling-bling闪几下」）。
  const [blink, setBlink] = useState(false);
  const wasShownRef = useRef(false);

  useEffect(() => {
    const next: Reminder[] = [];
    for (const task of tasks) {
      if (task.done || !task.due_at) continue;
      const { status, text } = dueStatus(task, now);
      if (status !== "due_soon" && status !== "overdue") continue;
      const key = `${task.id}:${status}`;
      if (firedRef.current.has(key)) continue;
      firedRef.current.add(key);
      next.push({ taskId: task.id, title: task.title, text });
    }
    if (next.length > 0) {
      setVisible((prev) => [...prev, ...next]);
      beep();
      navigator.vibrate?.([100, 50, 100]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- now 每 30 秒变一次，故意只用它当节流节点
  }, [now]);

  // 任务做完 / 被接走以后，提醒卡跟着撤掉（显示的是过时信息没用）。
  const liveIds = new Set(tasks.filter((t) => !t.done).map((t) => t.id));
  const shown = visible.filter((v) => liveIds.has(v.taskId));
  const isShown = shown.length > 0;

  useEffect(() => {
    if (isShown && !wasShownRef.current) {
      setBlink(true);
      const t = setTimeout(() => setBlink(false), 1300);
      wasShownRef.current = true;
      return () => clearTimeout(t);
    }
    if (!isShown) wasShownRef.current = false;
  }, [isShown]);

  if (shown.length === 0) return null;

  return (
    <div
      role="alert"
      aria-label="Task reminder"
      className={`fixed right-5 bottom-5 z-40 w-[320px] rounded-[14px] border-2 border-[#fbbf24] bg-[#0b1626] p-4 text-white shadow-[0_0_0_3px_rgba(251,191,36,0.35),0_12px_40px_rgba(0,0,0,0.55)] ${blink ? "animate-[reminder-blink_0.4s_ease-in-out_3]" : ""}`}
    >
      <p className="flex items-center gap-1.5 text-[13px] font-bold text-[#38bdf8]">
        🔔 Task reminder
      </p>
      <ul className="mt-2 flex flex-col gap-2.5">
        {shown.map((item) => (
          <li key={item.taskId}>
            <p className="text-[13px] font-semibold">{item.title}</p>
            <p className="text-[11.5px] text-[#fbbf24]">{item.text}</p>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[10.5px] text-white/40">
        Plays a sound when it appears. The same reminder is emailed to the
        reservations inbox.
      </p>
      <button
        type="button"
        onClick={() => setVisible([])}
        className="mt-3 w-full rounded-lg border border-white/15 py-1.5 text-[12.5px] font-semibold text-white/80 hover:text-white"
      >
        Got it
      </button>
    </div>
  );
}
