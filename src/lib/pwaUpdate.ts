export type UpdateResult = {
  type: "KHZ_PWA_RESULT";
  status: "applied" | "blocked";
  busy: number;
  unknown: number;
};
export function requestPWAUpdate(worker: ServiceWorker): Promise<UpdateResult> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const finish = (result?: UpdateResult) => {
      clearTimeout(timer);
      channel.port1.close();
      if (result) resolve(result);
      else
        reject(
          new Error("Не вдалося перевірити відкриті вікна. Спробуй ще раз."),
        );
    };
    const timer = setTimeout(() => finish(), 5000);
    channel.port1.onmessage = (event: MessageEvent<UpdateResult>) => {
      const result = event.data;
      if (
        result?.type === "KHZ_PWA_RESULT" &&
        (result.status === "applied" || result.status === "blocked") &&
        Number.isInteger(result.busy) &&
        result.busy >= 0 &&
        Number.isInteger(result.unknown) &&
        result.unknown >= 0 &&
        (result.status !== "applied" ||
          (result.busy === 0 && result.unknown === 0))
      )
        finish(result);
      else finish();
    };
    channel.port1.onmessageerror = () => finish();
    try {
      worker.postMessage({ type: "KHZ_PWA_APPLY", protocol: 1 }, [
        channel.port2,
      ]);
    } catch {
      finish();
    }
  });
}
