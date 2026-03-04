/**
 * Minimal DER/ASN.1 encoder for X.509 certificate construction.
 *
 * Only handles generation (not parsing). Used by CertManager to build
 * self-signed CA certs and per-host leaf certs without external dependencies.
 */

// ASN.1 tag constants
const TAG_INTEGER = 0x02;
const TAG_BIT_STRING = 0x03;
const TAG_OCTET_STRING = 0x04;
const TAG_NULL = 0x05;
const TAG_OID = 0x06;
const TAG_UTF8_STRING = 0x0c;
const TAG_PRINTABLE_STRING = 0x13;
const TAG_UTC_TIME = 0x17;
const TAG_SEQUENCE = 0x30;
const TAG_SET = 0x31;

/** Encode DER length bytes (short or long form). */
function derLength(len: number): Buffer {
  if (len < 0x80) return Buffer.from([len]);
  if (len < 0x100) return Buffer.from([0x81, len]);
  return Buffer.from([0x82, (len >> 8) & 0xff, len & 0xff]);
}

/** Wrap payload in a TLV (tag-length-value). */
function tlv(tag: number, payload: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), derLength(payload.length), payload]);
}

/** DER SEQUENCE */
export function derSequence(...items: Buffer[]): Buffer {
  return tlv(TAG_SEQUENCE, Buffer.concat(items));
}

/** DER SET */
export function derSet(...items: Buffer[]): Buffer {
  return tlv(TAG_SET, Buffer.concat(items));
}

/**
 * DER INTEGER from a Buffer of big-endian bytes.
 * Prepends 0x00 if high bit is set (positive sign).
 */
export function derInteger(value: Buffer | number): Buffer {
  if (typeof value === "number") {
    if (value < 0x80) return tlv(TAG_INTEGER, Buffer.from([value]));
    const bytes: number[] = [];
    let v = value;
    while (v > 0) {
      bytes.unshift(v & 0xff);
      v = v >> 8;
    }
    if (bytes[0] & 0x80) bytes.unshift(0);
    return tlv(TAG_INTEGER, Buffer.from(bytes));
  }
  // Strip leading zeros but keep at least one byte
  let start = 0;
  while (start < value.length - 1 && value[start] === 0) start++;
  const trimmed = value.subarray(start);
  const needsPad = trimmed[0] & 0x80;
  const payload = needsPad
    ? Buffer.concat([Buffer.from([0x00]), trimmed])
    : trimmed;
  return tlv(TAG_INTEGER, payload);
}

/** DER BIT STRING (no unused bits). */
export function derBitString(data: Buffer): Buffer {
  return tlv(TAG_BIT_STRING, Buffer.concat([Buffer.from([0x00]), data]));
}

/** DER OCTET STRING */
export function derOctetString(data: Buffer): Buffer {
  return tlv(TAG_OCTET_STRING, data);
}

/** DER NULL */
export function derNull(): Buffer {
  return Buffer.from([TAG_NULL, 0x00]);
}

/** DER OID from dotted-decimal string (e.g. "1.2.840.113549.1.1.11"). */
export function derOid(oid: string): Buffer {
  const parts = oid.split(".").map(Number);
  const bytes: number[] = [40 * parts[0] + parts[1]];
  for (let i = 2; i < parts.length; i++) {
    let val = parts[i];
    if (val < 128) {
      bytes.push(val);
    } else {
      const encoded: number[] = [];
      encoded.push(val & 0x7f);
      val >>= 7;
      while (val > 0) {
        encoded.push((val & 0x7f) | 0x80);
        val >>= 7;
      }
      encoded.reverse();
      bytes.push(...encoded);
    }
  }
  return tlv(TAG_OID, Buffer.from(bytes));
}

/** DER PrintableString */
export function derPrintableString(str: string): Buffer {
  return tlv(TAG_PRINTABLE_STRING, Buffer.from(str, "ascii"));
}

/** DER UTF8String */
export function derUtf8String(str: string): Buffer {
  return tlv(TAG_UTF8_STRING, Buffer.from(str, "utf-8"));
}

/** DER UTCTime from a Date (format: YYMMDDHHmmSSZ). */
export function derUtcTime(date: Date): Buffer {
  const y = date.getUTCFullYear().toString().slice(-2);
  const m = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const d = date.getUTCDate().toString().padStart(2, "0");
  const h = date.getUTCHours().toString().padStart(2, "0");
  const min = date.getUTCMinutes().toString().padStart(2, "0");
  const s = date.getUTCSeconds().toString().padStart(2, "0");
  return tlv(TAG_UTC_TIME, Buffer.from(`${y}${m}${d}${h}${min}${s}Z`, "ascii"));
}

/** DER context-specific explicit tag [n]. */
export function derExplicitTag(tagNum: number, inner: Buffer): Buffer {
  const tag = 0xa0 | tagNum;
  return tlv(tag, inner);
}

/** DER context-specific implicit tag [n] (for SubjectAltName dNSName etc.). */
export function derImplicitTag(tagNum: number, data: Buffer): Buffer {
  const tag = 0x80 | tagNum;
  return tlv(tag, data);
}
