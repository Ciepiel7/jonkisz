export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getExchange } = await import("./engine");
    getExchange();
  }
}