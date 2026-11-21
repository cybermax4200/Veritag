import { Keypair, TransactionBuilder } from "@stellar/stellar-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatRemainingWarranty,
  getEmbedBadgeMeta,
} from "../components/EmbedBadge.js";
import {
  classifyRpcError,
  STELLAR_STATUS_URL,
} from "../components/ErrorBoundary.js";
import { registerPasskeySmartWallet } from "../lib/passkey.js";
import {
  buildUnsignedRegistryTxXdr,
  getFileDownloadUrl,
  PUBLIC_CONFIG,
  signRegistryTxWithSecret,
  verifyProduct,
} from "../lib/stellar.js";

describe("@veritag/web verification & passkey wallet logic", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Offline test mode")),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves offline/demo verification states accurately across serial patterns", async () => {
    const brand = "GB7TAYRUZGE6TVT7NHP5SMIZRNQA6PLM423EYISAOAP3MKYIQMVYP2JO";
    const batch = "6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b";

    const unclaimed = await verifyProduct(brand, batch, "CH-2026-000101");
    expect(unclaimed.status).toBe("AuthenticInactive");
    expect(unclaimed.authentic).toBe(true);

    const active = await verifyProduct(brand, batch, "CH-2026-ACTIVE-04");
    expect(active.status).toBe("AuthenticActive");
    expect(active.unit?.warrantyValid).toBe(true);

    const dup = await verifyProduct(brand, batch, "CH-2026-DUP-88");
    expect(dup.status).toBe("AlreadyClaimedWarning");
    expect(dup.suspiciousScanVolume).toBe(true);

    const recalled = await verifyProduct(brand, batch, "CH-2026-RECALL-19");
    expect(recalled.status).toBe("Recalled");

    const fake = await verifyProduct(brand, batch, "FAKE-000999");
    expect(fake.status).toBe("Unknown");
    expect(fake.authentic).toBe(false);
  });

  it("generates P-256 passkey wallet credentials and formats file download URLs", async () => {
    const cred = await registerPasskeySmartWallet("Test Consumer Passkey");
    expect(cred.publicKeyHex.length).toBe(130);
    expect(cred.publicKeyHex.startsWith("04")).toBe(true);
    expect(cred.stellarSmartAddress.startsWith("C")).toBe(true);
    expect(cred.stellarSmartAddress.length).toBe(56);

    const fileUrl = getFileDownloadUrl("a".repeat(64));
    expect(fileUrl).toContain("/v1/files/" + "a".repeat(64));

    const kp = Keypair.random();
    const unsignedXdr = buildUnsignedRegistryTxXdr({
      callerAddress: kp.publicKey(),
      method: "commit_batch",
    });
    const signedXdr = signRegistryTxWithSecret(unsignedXdr, kp.secret());
    const parsedTx = TransactionBuilder.fromXDR(signedXdr, PUBLIC_CONFIG.networkPassphrase);
    expect(parsedTx.signatures.length).toBe(1);

    const passkeyUnsignedXdr = buildUnsignedRegistryTxXdr({
      callerAddress: cred.stellarSmartAddress,
      method: "activate",
    });
    expect(passkeyUnsignedXdr.length).toBeGreaterThan(20);
  });

  it("formats embeddable marketplace badge metadata and remaining warranty", async () => {
    const brand = "GB7TAYRUZGE6TVT7NHP5SMIZRNQA6PLM423EYISAOAP3MKYIQMVYP2JO";
    const batch = "6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b";

    const active = await verifyProduct(brand, batch, "CH-2026-ACTIVE-04");
    const activeMeta = getEmbedBadgeMeta(active);
    expect(activeMeta.label).toBe("Authentic · Active Warranty");
    expect(activeMeta.brandVerificationLabel).toContain("Verified Brand");
    expect(activeMeta.sealText).toContain("On-Chain Seal");

    const nowSec = 1_700_000_000;
    expect(formatRemainingWarranty(nowSec + 86_400 * 30, true, 24, nowSec)).toBe("30 days left");
    expect(formatRemainingWarranty(nowSec - 10, false, 24, nowSec)).toBe("Warranty Expired");
    expect(formatRemainingWarranty(undefined, undefined, 24, nowSec)).toBe("24 mo on activation");
  });

  it("classifies Stellar RPC 504 timeouts and exposes status link diagnostics", () => {
    const timeoutDiag = classifyRpcError(new Error("Soroban RPC HTTP 504 Gateway Timeout"));
    expect(timeoutDiag.isRpcTimeout).toBe(true);
    expect(timeoutDiag.statusCode).toBe(504);
    expect(timeoutDiag.title).toContain("Timed Out");

    const genericDiag = classifyRpcError(new Error("Unexpected rendering failure"));
    expect(genericDiag.isRpcTimeout).toBe(false);
    expect(genericDiag.statusCode).toBeUndefined();
    expect(STELLAR_STATUS_URL).toBe("https://status.stellar.org");
  });
});
