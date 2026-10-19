import { getExchange } from "@/engine";
import type { PublicSnapshot } from "@/engine";


export async function GET() {
  const engine = getExchange();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      const send = (snap: PublicSnapshot) => {
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(snap)}\n\n`));
        } catch {
          unsubscribe?.();
          if (heartbeat) clearInterval(heartbeat);
        }
      };

      send(engine.snapshot());
      unsubscribe = engine.subscribe(send);
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(enc.encode(`: ping\n\n`));
        } catch {
          // closed
        }
      }, 15000);
    },
    cancel() {
      unsubscribe?.();
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
