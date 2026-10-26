import cron from "node-cron";
import { syncDailyPrices } from "./dailySync";

let dailyTask: cron.ScheduledTask | null = null;

/**
 * 启动定时任务调度器
 * - 每天 15:30 执行收盘数据同步（A股收盘时间 15:00）
 * - 启动时立即执行一次补全
 */
export function startScheduler() {
  console.log("[Scheduler] Starting cron scheduler...");

  // 立即执行一次数据同步（启动时补全当天数据）
  syncDailyPrices().then((result) => {
    console.log(`[Scheduler] Initial sync: ${result.inserted}/${result.total} stocks`);
  }).catch((err) => {
    console.error("[Scheduler] Initial sync failed:", err);
  });

  // 每天 15:30 执行（A股 15:00 收盘，留出30分钟缓冲）
  dailyTask = cron.schedule("30 15 * * 1-5", async () => {
    console.log("[Scheduler] Daily market close sync triggered at 15:30");
    try {
      const result = await syncDailyPrices();
      console.log(`[Scheduler] Daily sync complete: ${result.inserted}/${result.total} stocks (${result.failed} failed)`);
    } catch (err) {
      console.error("[Scheduler] Daily sync failed:", err);
    }
  }, {
    scheduled: true,
    timezone: "Asia/Shanghai",
  });

  console.log("[Scheduler] Daily sync scheduled for 15:30 (Mon-Fri, Asia/Shanghai)");
}

/**
 * 手动触发数据同步（调试用）
 */
export async function manualSync() {
  console.log("[Scheduler] Manual sync triggered");
  return syncDailyPrices();
}

/**
 * 停止定时任务
 */
export function stopScheduler() {
  if (dailyTask) {
    dailyTask.stop();
    dailyTask = null;
    console.log("[Scheduler] Stopped");
  }
}
