import crypto from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import tls from "tls";
import {
  derSequence,
  derSet,
  derInteger,
  derBitString,
  derOctetString,
  derNull,
  derOid,
  derPrintableString,
  derUtcTime,
  derExplicitTag,
  derImplicitTag,
} from "./der.js";
import { logger } from "../logger.js";

// Well-known OIDs
const OID = {
  sha256WithRSA: "1.2.840.113549.1.1.11",
  rsaEncryption: "1.2.840.113549.1.1.1",
  commonName: "2.5.4.3",
  organizationName: "2.5.4.10",
  basicConstraints: "2.5.29.19",
  keyUsage: "2.5.29.15",
  subjectAltName: "2.5.29.17",
};

/** Build an X.500 Name (just CN + O). */
function buildName(cn: string, org?: string): Buffer {
  const rdns = [
    derSet(derSequence(derOid(OID.commonName), derPrintableString(cn))),
  ];
  if (org) {
    rdns.push(
      derSet(derSequence(derOid(OID.organizationName), derPrintableString(org))),
    );
  }
  return derSequence(...rdns);
}

/** Build AlgorithmIdentifier for sha256WithRSAEncryption. */
function algId(): Buffer {
  return derSequence(derOid(OID.sha256WithRSA), derNull());
}

/** Generate a random 16-byte serial number. */
function randomSerial(): Buffer {
  const buf = crypto.randomBytes(16);
  buf[0] &= 0x7f; // ensure positive
  return buf;
}

/**
 * Build a DER-encoded TBSCertificate and sign it, returning PEM.
 */
function buildCert(opts: {
  subject: Buffer;
  issuer: Buffer;
  publicKeyDer: Buffer;
  privateKey: crypto.KeyObject;
  notBefore: Date;
  notAfter: Date;
  extensions: Buffer[];
}): string {
  const version = derExplicitTag(0, derInteger(2)); // v3
  const serial = derInteger(randomSerial());
  const validity = derSequence(
    derUtcTime(opts.notBefore),
    derUtcTime(opts.notAfter),
  );
  const spki = Buffer.from(opts.publicKeyDer);
  const extensionsSeq = derExplicitTag(3, derSequence(...opts.extensions));

  const tbs = derSequence(
    version,
    serial,
    algId(),
    opts.issuer,
    validity,
    opts.subject,
    spki,
    extensionsSeq,
  );

  const signer = crypto.createSign("SHA256");
  signer.update(tbs);
  const signature = signer.sign(opts.privateKey);

  const cert = derSequence(tbs, algId(), derBitString(signature));
  const b64 = cert.toString("base64");
  const lines = b64.match(/.{1,64}/g) ?? [];
  return `-----BEGIN CERTIFICATE-----\n${lines.join("\n")}\n-----END CERTIFICATE-----\n`;
}

/**
 * Manages CA and per-host TLS certificates for the MITM proxy.
 *
 * - Generates a self-signed CA on first run, caches to disk.
 * - Generates per-host leaf certs on the fly, cached in-memory (LRU).
 * - Zero external dependencies — uses Node crypto + our DER encoder.
 */
export class CertManager {
  private caDir: string;
  private caKeyPath: string;
  private caCertPath: string;
  private caKey: crypto.KeyObject | null = null;
  private caCertPem: string | null = null;
  private caCertDer: Buffer | null = null;
  private hostCache = new Map<string, tls.SecureContext>();
  private static MAX_HOST_CACHE = 100;

  constructor(mortDir: string) {
    this.caDir = join(mortDir, "proxy-ca");
    this.caKeyPath = join(this.caDir, "ca-key.pem");
    this.caCertPath = join(this.caDir, "ca-cert.pem");
  }

  /** Generate CA key + cert if not already on disk. Idempotent. */
  async ensureCA(): Promise<{ certPath: string; keyPath: string }> {
    mkdirSync(this.caDir, { recursive: true });

    if (existsSync(this.caCertPath) && existsSync(this.caKeyPath)) {
      if (this.loadExistingCA()) {
        return { certPath: this.caCertPath, keyPath: this.caKeyPath };
      }
      logger.info("[cert-manager] Existing CA expired or invalid, regenerating");
    }

    this.generateCA();
    return { certPath: this.caCertPath, keyPath: this.caKeyPath };
  }

  /** Generate a TLS SecureContext for a given hostname, signed by our CA. */
  certForHost(hostname: string): tls.SecureContext {
    const cached = this.hostCache.get(hostname);
    if (cached) return cached;

    this.evictIfNeeded();

    const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });

    const spkiDer = publicKey.export({ type: "spki", format: "der" });

    // SubjectAltName: dNSName (tag 2)
    const sanValue = derSequence(
      derOid(OID.subjectAltName),
      derOctetString(
        derSequence(derImplicitTag(2, Buffer.from(hostname, "ascii"))),
      ),
    );

    const now = new Date();
    const notAfter = new Date(now);
    notAfter.setDate(notAfter.getDate() + 30);

    const pem = buildCert({
      subject: buildName(hostname),
      issuer: this.caSubject(),
      publicKeyDer: spkiDer,
      privateKey: this.caKey!,
      notBefore: now,
      notAfter,
      extensions: [sanValue],
    });

    const ctx = tls.createSecureContext({
      key: privateKey.export({ type: "pkcs8", format: "pem" }),
      cert: pem + this.caCertPem!,
    });

    this.hostCache.set(hostname, ctx);
    return ctx;
  }

  /** Path to the CA certificate file (for NODE_EXTRA_CA_CERTS). */
  get certPath(): string {
    return this.caCertPath;
  }

  private loadExistingCA(): boolean {
    try {
      const certPem = readFileSync(this.caCertPath, "utf-8");
      const x509 = new crypto.X509Certificate(certPem);

      // Check expiry (regenerate if <30 days remaining)
      const validTo = new Date(x509.validTo);
      const thirtyDays = 30 * 24 * 60 * 60 * 1000;
      if (validTo.getTime() - Date.now() < thirtyDays) return false;

      this.caCertPem = certPem;
      this.caCertDer = x509.raw;
      this.caKey = crypto.createPrivateKey(readFileSync(this.caKeyPath, "utf-8"));
      logger.info("[cert-manager] Loaded existing CA certificate");
      return true;
    } catch {
      return false;
    }
  }

  private generateCA(): void {
    logger.info("[cert-manager] Generating new CA certificate");
    const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });

    const spkiDer = publicKey.export({ type: "spki", format: "der" });
    const now = new Date();
    const notAfter = new Date(now);
    notAfter.setFullYear(notAfter.getFullYear() + 1);

    const subject = buildName("Mort Debug Proxy CA", "Mort");

    // Extensions: BasicConstraints (CA:true, critical) + KeyUsage (keyCertSign, critical)
    const basicConstraints = derSequence(
      derOid(OID.basicConstraints),
      Buffer.from([0x01, 0x01, 0xff]), // critical = true
      derOctetString(derSequence(Buffer.from([0x01, 0x01, 0xff]))), // CA:TRUE
    );
    const keyUsage = derSequence(
      derOid(OID.keyUsage),
      Buffer.from([0x01, 0x01, 0xff]), // critical = true
      derOctetString(derBitString(Buffer.from([0x06]))), // keyCertSign + cRLSign
    );

    const pem = buildCert({
      subject,
      issuer: subject,
      publicKeyDer: spkiDer,
      privateKey,
      notBefore: now,
      notAfter,
      extensions: [basicConstraints, keyUsage],
    });

    const keyPem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
    writeFileSync(this.caKeyPath, keyPem, { mode: 0o600 });
    writeFileSync(this.caCertPath, pem, { mode: 0o644 });

    this.caCertPem = pem;
    this.caCertDer = new crypto.X509Certificate(pem).raw;
    this.caKey = privateKey;
    logger.info("[cert-manager] CA certificate generated");
  }

  private caSubject(): Buffer {
    return buildName("Mort Debug Proxy CA", "Mort");
  }

  private evictIfNeeded(): void {
    if (this.hostCache.size >= CertManager.MAX_HOST_CACHE) {
      // Evict oldest entry (first inserted)
      const firstKey = this.hostCache.keys().next().value;
      if (firstKey) this.hostCache.delete(firstKey);
    }
  }
}
