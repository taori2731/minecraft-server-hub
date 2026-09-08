import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

interface RelayKey {
  id: string;
  value: Buffer;
}

interface CipherEnvelope {
  v: 1;
  k: string;
  n: string;
  t: string;
  c: string;
}

export class RelayKeyring {
  private readonly byId: Map<string, Buffer>;

  constructor(private readonly keys: RelayKey[]) {
    if (keys.length === 0) throw new Error("relay-keyring-empty");
    this.byId = new Map(keys.map((key) => [key.id, key.value]));
    if (this.byId.size !== keys.length) throw new Error("relay-key-id-duplicate");
    for (const key of keys) {
      if (!/^[A-Za-z0-9_-]{1,32}$/u.test(key.id) || key.value.length !== 32) {
        throw new Error("relay-key-invalid");
      }
    }
  }

  static fromEnvironment(value: string | undefined): RelayKeyring {
    if (!value) throw new Error("MSH_CO_MANAGEMENT_RELAY_KEYS is required");
    const keys = value.split(",").map((entry) => {
      const separator = entry.indexOf(":");
      if (separator <= 0) throw new Error("relay-key-invalid");
      return {
        id: entry.slice(0, separator),
        value: Buffer.from(entry.slice(separator + 1), "base64url"),
      };
    });
    return new RelayKeyring(keys);
  }

  activeKeyId(): string {
    return this.keys[0].id;
  }

  encrypt(value: string): Buffer {
    const active = this.keys[0];
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", active.value, nonce);
    cipher.setAAD(Buffer.from("msh-co-management-relay:" + active.id, "utf8"));
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    const envelope: CipherEnvelope = {
      v: 1,
      k: active.id,
      n: nonce.toString("base64url"),
      t: cipher.getAuthTag().toString("base64url"),
      c: encrypted.toString("base64url"),
    };
    return Buffer.from(JSON.stringify(envelope), "utf8");
  }

  decrypt(value: Buffer): string {
    let envelope: CipherEnvelope;
    try {
      envelope = JSON.parse(value.toString("utf8")) as CipherEnvelope;
    } catch {
      throw new Error("relay-ciphertext-invalid");
    }
    const key = envelope?.v === 1 ? this.byId.get(envelope.k) : undefined;
    if (!key) throw new Error("relay-key-unavailable");
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.n, "base64url"));
      decipher.setAAD(Buffer.from("msh-co-management-relay:" + envelope.k, "utf8"));
      decipher.setAuthTag(Buffer.from(envelope.t, "base64url"));
      return Buffer.concat([
        decipher.update(Buffer.from(envelope.c, "base64url")),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      throw new Error("relay-ciphertext-invalid");
    }
  }
}
