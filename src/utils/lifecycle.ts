import { LifecycleController } from "./lifecycle-core";
import { metrics } from "./metrics";

const controller = new LifecycleController();

const syncMetrics = () => metrics.setLifecycleSnapshot(controller.snapshot());

export const lifecycle = {
  markReady() {
    const changed = controller.markReady();
    syncMetrics();
    return changed;
  },

  startDraining(reason: string) {
    const changed = controller.startDraining(reason);
    syncMetrics();
    return changed;
  },

  markStopped() {
    controller.markStopped();
    syncMetrics();
  },

  beginRequest() {
    const release = controller.beginRequest();
    syncMetrics();
    return () => {
      release();
      syncMetrics();
    };
  },

  isReady() {
    return controller.isReady();
  },

  isDraining() {
    return controller.isDraining();
  },

  snapshot() {
    return controller.snapshot();
  },
};

syncMetrics();
