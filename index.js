import eiolite from "eiolite";
import { Decoder, Encoder, PacketType } from "./socket.io-parser.js";
const internalClose = Symbol();
const internalSend = Symbol();
const internalPorts = Symbol();
const internalROProp = Symbol();
export default class siolite extends EventTarget {
  constructor(url = "/socket.io/") {
    super();
    const setROProp = (prop, value, hidden) =>
      Object.defineProperty(this, prop, {
        value,
        configurable: true,
        enumerable: !hidden,
      });
    setROProp(internalROProp, setROProp, true);
    let eio;
    setROProp("url", url);
    const events = new EventTarget();
    const event = (e) => this.dispatchEvent(new Event(e));
    const decoder = new Decoder();
    const encoder = new Encoder();
    const queue = [];
    const send = (packet, skip) => {
      if (this.readyState === 0 && !skip) {
        queue.push(packet);
      } else {
        encoder.encode(packet).map((e) => eio.send(e));
      }
    };
    setROProp(internalSend, send, true);
    setROProp(internalPorts, new Map(), true);
    setROProp("readyState", 0);
    decoder.addEventListener("decoded", (e) => {
      const packet = e.detail;
      switch (packet.type) {
        case PacketType.CONNECT:
          setROProp("sid", packet.data.sid);
          setROProp("readyState", 1);
          let message;
          while ((message = queue.pop())) {
            send(message);
          }
          event("open");
          break;
        case PacketType.EVENT:
          const port = this[internalPorts].get(packet.data[0]);
          if (port)
            port.dispatchEvent(
              new MessageEvent("message", { data: packet.data[1] })
            );
          break;
        case PacketType.DISCONNECT:
          setROProp("readyState", 2);
          eio.close();
          break;
      }
    });
    let retryDelay = 100;
    const maxRetryDelay = 30000;
    const retryFactor = 2;
    const jitterFactor = 0.2;
    const connect = () => {
      eio = new eiolite(url);
      setROProp(internalClose, () => eio.close(), true);
      eio.addEventListener("message", (e) => {
        decoder.add(e.data);
      });
      eio.addEventListener("open", () => {
        send({ type: PacketType.CONNECT }, true);
      });
      eio.addEventListener("close", () => {
        if (this.readyState < 2) {
          setROProp("readyState", 0);
          scheduleRetry();
          this.dispatchEvent(new Event("reconnecting"));
        } else {
          setROProp("readyState", 3);
          this.dispatchEvent(new Event("close"));
        }
      });
    };
    const scheduleRetry = () => {
      retryDelay = Math.min(retryDelay * retryFactor, maxRetryDelay);
      setTimeout(
        connect,
        retryDelay + (Math.random() * 2 - 1) * jitterFactor * retryDelay
      );
    };
    connect();
  }
  port(port) {
    let p = this[internalPorts].get(port);
    if (p) return p;
    const t = new EventTarget();
    t.postMessage = (data) =>
      this[internalSend]({
        type: PacketType.EVENT,
        data: [port, data],
      });
    this[internalPorts].set(port, t);
    return t;
  }
  close() {
    if (this.readyState < 2) {
      this[internalROProp]("readyState", 2);
      this[internalSend]({ type: PacketType.DISCONNECT, namespace: "/" });
      this[internalClose]();
    }
  }
}
