import http from "http";
import type { Express } from "express";
import type { Database } from "./utils/db";
import type { CleanupTask } from "./jobs/cleanup.job";
import type { Logger } from "./utils/logger";

interface ServiceDependencies {
  app: Express;
  port: number;
  database: Pick<Database, "connect" | "disconnect">;
  startCleanup(): CleanupTask;
  logger?: Logger;
}

/** Owns resource acquisition and release; importing this module starts nothing. */
export const createService = ({ app, port, database, startCleanup, logger = console }: ServiceDependencies) => {
  const abort = new AbortController();
  let server: http.Server | undefined;
  let cleanup: CleanupTask | undefined;
  let startup: Promise<void> | undefined;
  let stopping: Promise<void> | undefined;
  let draining: Promise<void> | undefined;

  const drain = (): Promise<void> => {
    draining ??= (async () => {
      const results = await Promise.allSettled([
        Promise.resolve().then(() => cleanup?.stop()),
        new Promise<void>((resolve, reject) => {
          if (!server?.listening) return resolve();
          server.close((error) => error ? reject(error) : resolve());
        }),
      ]);
      try { await database.disconnect(); }
      catch (reason) { results.push({ status: "rejected", reason }); }
      const failure = results.find((result) => result.status === "rejected");
      if (failure?.status === "rejected") throw failure.reason;
    })();
    return draining;
  };

  const start = (): Promise<void> => {
    startup ??= (async () => {
      try {
        abort.signal.throwIfAborted();
        await database.connect(abort.signal);
        abort.signal.throwIfAborted();
        server = http.createServer(app);
        await new Promise<void>((resolve, reject) => {
          const onError = (error: Error) => reject(error);
          server!.once("error", onError);
          server!.listen(port, () => {
            server!.off("error", onError);
            resolve();
          });
        });
        abort.signal.throwIfAborted();
        cleanup = startCleanup();
        logger.log(`Nearby Location Service running on port ${port}`);
      } catch (error) {
        try { await drain(); }
        catch (cleanupError) { logger.error("Startup shutdown failed:", cleanupError); }
        throw error;
      }
    })();
    return startup;
  };

  const stop = (): Promise<void> => {
    abort.abort();
    stopping ??= (async () => {
      // Startup observes cancellation before opening further resources.
      await startup?.catch(() => {});
      await drain();
    })();
    return stopping;
  };
  return { start, stop };
};

export type Service = ReturnType<typeof createService>;

/** Only the executable calls this process-level adapter. Repeated signals drain once. */
export const runService = async (service: Service, logger: Logger = console): Promise<void> => {
  let stopping = false;
  let completed: Promise<void> | undefined;
  const finish = (reason: string, exitCode: number): Promise<void> => {
    stopping = true;
    completed ??= (async () => {
      logger.log(`Received ${reason}, shutting down gracefully...`);
      try { await service.stop(); process.exitCode = exitCode; }
      catch (error) { logger.error("Graceful shutdown failed:", error); process.exitCode = 1; }
      finally {
        process.off("SIGTERM", onTerminate);
        process.off("SIGINT", onInterrupt);
      }
    })();
    return completed;
  };
  const onTerminate = () => { void finish("SIGTERM", 0); };
  const onInterrupt = () => { void finish("SIGINT", 0); };
  process.on("SIGTERM", onTerminate);
  process.on("SIGINT", onInterrupt);
  try { await service.start(); }
  catch (error) {
    if (!stopping) {
      logger.error("Failed to start server:", error);
      await finish("startup failure", 1);
    }
  }
};
