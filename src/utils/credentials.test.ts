import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  encryptToken,
  decryptToken,
  saveCredentials,
  loadCredentials,
  deleteCredentials,
  getCredentialsPath,
} from "./credentials";

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return {
    ...actual,
    homedir: () => os.tmpdir().replace(/\/$/, "") + "/.codacy-home-" + process.pid,
  };
});

describe("credentials", () => {
  const credentialsDir = path.join(
    os.tmpdir().replace(/\/$/, "") + "/.codacy-home-" + process.pid,
    ".codacy",
  );
  const credentialsFile = path.join(credentialsDir, "credentials");

  beforeEach(() => {
    fs.rmSync(credentialsDir, { recursive: true, force: true });
  });

  afterEach(() => {
    fs.rmSync(credentialsDir, { recursive: true, force: true });
  });

  describe("encryptToken / decryptToken", () => {
    it("should round-trip a token", () => {
      const token = "codacy_abcdef123456";
      const encrypted = encryptToken(token);
      const decrypted = decryptToken(encrypted);
      expect(decrypted).toBe(token);
    });

    it("should produce valid JSON with expected fields", () => {
      const encrypted = encryptToken("test-token");
      const parsed = JSON.parse(encrypted);
      expect(parsed).toHaveProperty("salt");
      expect(parsed).toHaveProperty("iv");
      expect(parsed).toHaveProperty("authTag");
      expect(parsed).toHaveProperty("encrypted");
    });

    it("should produce different ciphertexts for the same token (random salt/iv)", () => {
      const token = "same-token";
      const a = encryptToken(token);
      const b = encryptToken(token);
      expect(a).not.toBe(b);

      expect(decryptToken(a)).toBe(token);
      expect(decryptToken(b)).toBe(token);
    });

    it("should throw on tampered ciphertext", () => {
      const encrypted = encryptToken("my-secret");
      const parsed = JSON.parse(encrypted);
      parsed.encrypted = "deadbeef";
      expect(() => decryptToken(JSON.stringify(parsed))).toThrow();
    });

    it("should throw on invalid JSON", () => {
      expect(() => decryptToken("not-json")).toThrow();
    });
  });

  describe("saveCredentials / loadCredentials", () => {
    it("should save and load a token", () => {
      saveCredentials("my-api-token");
      const loaded = loadCredentials();
      expect(loaded).toBe("my-api-token");
    });

    it("should create the directory if it does not exist", () => {
      expect(fs.existsSync(credentialsDir)).toBe(false);
      saveCredentials("token");
      expect(fs.existsSync(credentialsDir)).toBe(true);
    });

    it("should overwrite existing credentials", () => {
      saveCredentials("old-token");
      saveCredentials("new-token");
      expect(loadCredentials()).toBe("new-token");
    });
  });

  describe("loadCredentials", () => {
    it("should return null when file does not exist", () => {
      expect(loadCredentials()).toBeNull();
    });

    it("should return null when file is corrupt", () => {
      fs.mkdirSync(credentialsDir, { recursive: true });
      fs.writeFileSync(
        credentialsFile,
        "this is not valid encrypted data",
        "utf8",
      );
      expect(loadCredentials()).toBeNull();
    });

    it("should return null when JSON is valid but fields are wrong", () => {
      fs.mkdirSync(credentialsDir, { recursive: true });
      fs.writeFileSync(
        credentialsFile,
        JSON.stringify({ salt: "aa", iv: "bb", authTag: "cc", encrypted: "dd" }),
        "utf8",
      );
      expect(loadCredentials()).toBeNull();
    });
  });

  describe("deleteCredentials", () => {
    it("should delete existing credentials and return true", () => {
      saveCredentials("to-delete");
      expect(deleteCredentials()).toBe(true);
      expect(fs.existsSync(credentialsFile)).toBe(false);
    });

    it("should return false when no credentials exist", () => {
      expect(deleteCredentials()).toBe(false);
    });
  });

  describe("getCredentialsPath", () => {
    it("should return a path ending with .codacy/credentials", () => {
      const p = getCredentialsPath();
      expect(p).toMatch(/\.codacy[/\\]credentials$/);
    });
  });
});
