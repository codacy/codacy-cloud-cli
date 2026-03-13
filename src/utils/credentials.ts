import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const CREDENTIALS_DIR = path.join(os.homedir(), ".codacy");
const CREDENTIALS_FILE = path.join(CREDENTIALS_DIR, "credentials");

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const SALT_LENGTH = 32;
const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_DIGEST = "sha512";

interface EncryptedPayload {
  salt: string;
  iv: string;
  authTag: string;
  encrypted: string;
}

function getMachineKey(): string {
  const info = os.userInfo();
  return [os.hostname(), info.username, os.homedir(), os.platform()].join("|");
}

function deriveKey(machineKey: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(
    machineKey,
    salt,
    PBKDF2_ITERATIONS,
    KEY_LENGTH,
    PBKDF2_DIGEST,
  );
}

export function encryptToken(token: string): string {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = deriveKey(getMachineKey(), salt);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  const payload: EncryptedPayload = {
    salt: salt.toString("hex"),
    iv: iv.toString("hex"),
    authTag: authTag.toString("hex"),
    encrypted: encrypted.toString("hex"),
  };

  return JSON.stringify(payload);
}

export function decryptToken(payloadJson: string): string {
  const payload: EncryptedPayload = JSON.parse(payloadJson);

  const salt = Buffer.from(payload.salt, "hex");
  const iv = Buffer.from(payload.iv, "hex");
  const authTag = Buffer.from(payload.authTag, "hex");
  const encrypted = Buffer.from(payload.encrypted, "hex");
  const key = deriveKey(getMachineKey(), salt);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

export function getCredentialsPath(): string {
  return CREDENTIALS_FILE;
}

export function saveCredentials(token: string): void {
  if (!fs.existsSync(CREDENTIALS_DIR)) {
    fs.mkdirSync(CREDENTIALS_DIR, { recursive: true, mode: 0o700 });
  }

  const payload = encryptToken(token);
  fs.writeFileSync(CREDENTIALS_FILE, payload, { encoding: "utf8", mode: 0o600 });
}

export function loadCredentials(): string | null {
  if (!fs.existsSync(CREDENTIALS_FILE)) {
    return null;
  }

  const payload = fs.readFileSync(CREDENTIALS_FILE, "utf8");

  try {
    return decryptToken(payload);
  } catch {
    // Treat invalid/corrupted credentials as "no credentials"
    return null;
  }
}

export function deleteCredentials(): boolean {
  if (!fs.existsSync(CREDENTIALS_FILE)) {
    return false;
  }

  try {
    fs.unlinkSync(CREDENTIALS_FILE);
    return true;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      // File was removed between the existence check and unlink
      return false;
    }
    throw error;
  }
}

export function promptForToken(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(new Error("Interactive input required. Use --token <value> instead."));
      return;
    }

    process.stdout.write(prompt);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");

    let token = "";

    const onData = (char: string) => {
      const chunk = char.toString();

      for (const c of chunk) {
        if (c === "\n" || c === "\r") {
          cleanup();
          process.stdout.write("\n");
          resolve(token);
          return;
        } else if (c === "\u0003") {
          cleanup();
          process.stdout.write("\n");
          process.exit(1);
          return;
        } else if (c === "\u007f" || c === "\b") {
          if (token.length > 0) {
            token = token.slice(0, -1);
            process.stdout.write("\b \b");
          }
        } else if (c >= " ") {
          token += c;
          process.stdout.write("*");
        }
      }
    };

    const cleanup = () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener("data", onData);
    };

    process.stdin.on("data", onData);
  });
}
