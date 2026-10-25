import code from "eve/extensions/code";

// The read-only worker defaults to an OpenAI model, which the Token Pass key
// refuses, so it runs on Kimi like the root agent.
export default code({
  worker: { model: "moonshotai/kimi-k3", reasoning: "high" },
});
