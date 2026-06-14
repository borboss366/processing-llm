import { Client, Message } from "node-osc";

export const OSC_PORT = parseInt(process.env["OSC_PORT"] ?? "12000", 10);
const OSC_HOST = "127.0.0.1";

const client = new Client(OSC_HOST, OSC_PORT);

export function sendOsc(address: string, ...args: Array<number | string>): void {
  const msg = new Message(address);
  for (const arg of args) msg.append(arg);
  client.send(msg, (err) => {
    if (err) console.error(`[OSC] send error: ${err}`);
  });
}
