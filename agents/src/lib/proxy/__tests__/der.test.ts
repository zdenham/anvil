import { describe, it, expect } from "vitest";
import {
  derSequence,
  derInteger,
  derOid,
  derPrintableString,
  derUtcTime,
  derBitString,
  derOctetString,
  derNull,
  derExplicitTag,
  derSet,
  derImplicitTag,
} from "../der.js";

describe("DER encoder", () => {
  it("encodes small integer", () => {
    const buf = derInteger(5);
    // TAG(02) LEN(01) VALUE(05)
    expect(buf).toEqual(Buffer.from([0x02, 0x01, 0x05]));
  });

  it("encodes integer with high bit set (needs padding)", () => {
    const buf = derInteger(128);
    // TAG(02) LEN(02) PAD(00) VALUE(80)
    expect(buf).toEqual(Buffer.from([0x02, 0x02, 0x00, 0x80]));
  });

  it("encodes Buffer integer with leading zeros stripped", () => {
    const buf = derInteger(Buffer.from([0x00, 0x00, 0x01]));
    expect(buf).toEqual(Buffer.from([0x02, 0x01, 0x01]));
  });

  it("encodes Buffer integer with padding for high bit", () => {
    const buf = derInteger(Buffer.from([0xff]));
    expect(buf).toEqual(Buffer.from([0x02, 0x02, 0x00, 0xff]));
  });

  it("encodes NULL", () => {
    expect(derNull()).toEqual(Buffer.from([0x05, 0x00]));
  });

  it("encodes OID for commonName (2.5.4.3)", () => {
    const buf = derOid("2.5.4.3");
    // 2*40+5=85, 4, 3
    expect(buf[0]).toBe(0x06); // TAG
    expect(buf[2]).toBe(85);   // 2*40+5
    expect(buf[3]).toBe(4);
    expect(buf[4]).toBe(3);
  });

  it("encodes OID with multi-byte component (sha256WithRSA)", () => {
    const buf = derOid("1.2.840.113549.1.1.11");
    expect(buf[0]).toBe(0x06); // TAG
    // 840 and 113549 require multi-byte encoding
    expect(buf.length).toBeGreaterThan(5);
  });

  it("encodes PrintableString", () => {
    const buf = derPrintableString("test");
    expect(buf[0]).toBe(0x13); // TAG
    expect(buf[1]).toBe(4);    // LEN
    expect(buf.subarray(2).toString("ascii")).toBe("test");
  });

  it("encodes UTCTime", () => {
    const date = new Date("2025-06-15T12:30:45Z");
    const buf = derUtcTime(date);
    expect(buf[0]).toBe(0x17); // TAG
    expect(buf.subarray(2).toString("ascii")).toBe("250615123045Z");
  });

  it("encodes SEQUENCE", () => {
    const inner = derInteger(1);
    const seq = derSequence(inner);
    expect(seq[0]).toBe(0x30); // TAG
    expect(seq[1]).toBe(inner.length);
    expect(seq.subarray(2)).toEqual(inner);
  });

  it("encodes SET", () => {
    const inner = derInteger(1);
    const set = derSet(inner);
    expect(set[0]).toBe(0x31); // TAG
  });

  it("encodes BIT STRING with zero unused bits", () => {
    const data = Buffer.from([0x05]);
    const buf = derBitString(data);
    expect(buf[0]).toBe(0x03); // TAG
    expect(buf[2]).toBe(0x00); // unused bits
    expect(buf[3]).toBe(0x05);
  });

  it("encodes OCTET STRING", () => {
    const data = Buffer.from([0x01, 0x02]);
    const buf = derOctetString(data);
    expect(buf[0]).toBe(0x04); // TAG
    expect(buf[1]).toBe(2);
  });

  it("encodes explicit tag", () => {
    const inner = derInteger(2);
    const tagged = derExplicitTag(0, inner);
    expect(tagged[0]).toBe(0xa0); // context [0] constructed
  });

  it("encodes implicit tag", () => {
    const data = Buffer.from("test", "ascii");
    const tagged = derImplicitTag(2, data);
    expect(tagged[0]).toBe(0x82); // context [2]
  });
});
