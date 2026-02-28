import { validateIdToken } from "../src/services/oauth.js";
import jwt from "jsonwebtoken";
import jwksClient from "jwks-rsa";
import { beforeEach, describe, expect, it, Mock, vi } from "vitest";
import { AuthProvider } from "../src/types/index.js";

vi.mock("jwks-rsa");
vi.mock("jsonwebtoken");

describe.each([
  AuthProvider.GOOGLE,
  AuthProvider.MICROSOFT,
  AuthProvider.APPLE,
])("validateIdToken (%s)", (provider) => {
  const validKid = "test-kid";
  const validSigningKey = "test-public-key";
  const validIdToken = "valid.id.token";

  beforeEach(() => {
    vi.resetAllMocks();
    process.env[`${provider.toUpperCase()}_CLIENT_ID`] = "test-client-id";
    process.env.MICROSOFT_TENANT_ID = "test-tenant-id"; // for MS flow
  });

  it("throws if CLIENT_ID is missing", async () => {
    delete process.env[`${provider.toUpperCase()}_CLIENT_ID`];
    await expect(validateIdToken(validIdToken, provider)).rejects.toThrow(
      `[${provider}] Missing CLIENT_ID environment variable`
    );
  });

  it("throws if token header is invalid", async () => {
    (jwt.decode as unknown as Mock).mockReturnValueOnce(undefined);

    await expect(validateIdToken(validIdToken, provider)).rejects.toThrow(
      `[${provider}] Invalid token header`
    );
  });

  it("throws if kid is missing", async () => {
    (jwt.decode as unknown as Mock).mockReturnValueOnce({
      header: {},
    });

    await expect(validateIdToken(validIdToken, provider)).rejects.toThrow(
      `[${provider}] Missing kid in token header`
    );
  });

  it("throws if JWKS key retrieval fails", async () => {
    (jwt.decode as unknown as Mock).mockReturnValueOnce({
      header: { kid: validKid },
    });

    (jwksClient as unknown as Mock).mockReturnValueOnce({
      getSigningKey: vi.fn().mockRejectedValue(new Error("JWKS error")),
    });

    await expect(validateIdToken(validIdToken, provider)).rejects.toThrow(
      `[${provider}] Failed to retrieve signing key for kid test-kid`
    );
  });

  it("throws on invalid signature", async () => {
    (jwt.decode as unknown as Mock).mockReturnValueOnce({
      header: { kid: validKid },
    });

    (jwksClient as unknown as Mock).mockReturnValueOnce({
      getSigningKey: vi.fn().mockResolvedValue({
        getPublicKey: () => validSigningKey,
      }),
    });

    (jwt.verify as unknown as Mock).mockImplementationOnce(
      (_token, _key, _opts, callback) => {
        callback(new Error("invalid signature"), undefined);
      }
    );

    await expect(validateIdToken(validIdToken, provider)).rejects.toThrow(
      `[${provider}] Token verification failed: invalid signature`
    );
  });

  it("throws on expired token", async () => {
    (jwt.decode as unknown as Mock).mockReturnValueOnce({
      header: { kid: validKid },
    });

    (jwksClient as unknown as Mock).mockReturnValueOnce({
      getSigningKey: vi.fn().mockResolvedValue({
        getPublicKey: () => validSigningKey,
      }),
    });

    (jwt.verify as unknown as Mock).mockImplementationOnce(
      (_token, _key, _opts, callback) => {
        callback(new Error("jwt expired"), undefined);
      }
    );

    await expect(
      validateIdToken(validIdToken, provider, { maxAgeSeconds: 60 })
    ).rejects.toThrow(`[${provider}] Token verification failed: jwt expired`);
  });

  it("throws on nonce mismatch", async () => {
    (jwt.decode as unknown as Mock).mockReturnValueOnce({
      header: { kid: validKid },
    });

    (jwksClient as unknown as Mock).mockReturnValueOnce({
      getSigningKey: vi.fn().mockResolvedValue({
        getPublicKey: () => validSigningKey,
      }),
    });

    (jwt.verify as unknown as Mock).mockImplementationOnce(
      (_token, _key, options, callback) => {
        expect(options).toHaveProperty("nonce", "expected-nonce");
        callback(new Error("nonce mismatch"), undefined);
      }
    );

    await expect(
      validateIdToken(validIdToken, provider, { nonce: "expected-nonce" })
    ).rejects.toThrow(
      `[${provider}] Token verification failed: nonce mismatch`
    );
  });

  it("throws on invalid issuer", async () => {
    (jwt.decode as unknown as Mock).mockReturnValueOnce({
      header: { kid: validKid },
    });

    (jwksClient as unknown as Mock).mockReturnValueOnce({
      getSigningKey: vi.fn().mockResolvedValue({
        getPublicKey: () => validSigningKey,
      }),
    });

    (jwt.verify as unknown as Mock).mockImplementationOnce(
      (_token, _key, options, callback) => {
        // Simulate a mismatch in expected issuer
        expect(options).toHaveProperty("issuer");
        callback(new Error("invalid issuer"), undefined);
      }
    );

    await expect(validateIdToken(validIdToken, provider)).rejects.toThrow(
      `[${provider}] Token verification failed: invalid issuer`
    );
  });

  it("resolves valid token", async () => {
    const validPayload = { sub: "user123", email: "test@example.com" };

    (jwt.decode as unknown as Mock).mockReturnValueOnce({
      header: { kid: validKid },
    });

    (jwksClient as unknown as Mock).mockReturnValueOnce({
      getSigningKey: vi.fn().mockResolvedValue({
        getPublicKey: () => validSigningKey,
      }),
    });

    (jwt.verify as unknown as Mock).mockImplementationOnce(
      (_token, _key, _opts, callback) => {
        callback(null, validPayload);
      }
    );

    const result = await validateIdToken(validIdToken, provider);
    expect(result).toEqual(validPayload);
  });
});
