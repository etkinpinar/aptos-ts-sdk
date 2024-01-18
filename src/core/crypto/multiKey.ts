import { AuthenticationKey } from "../authenticationKey";
import { Hex } from "../hex";
import { HexInput, SigningScheme as AuthenticationKeyScheme } from "../../types";
import { Deserializer } from "../../bcs/deserializer";
import { Serializable, Serializer } from "../../bcs/serializer";
import { Ed25519PublicKey, Ed25519Signature } from "./ed25519";
import { Secp256k1PublicKey, Secp256k1Signature } from "./secp256k1";
import { AnyPublicKey, AnySignature } from "./singleKey";

type PublicKeyInput = Ed25519PublicKey | Secp256k1PublicKey | AnyPublicKey;
type SignatureInput = Ed25519Signature | Secp256k1Signature | AnySignature;

/* eslint-disable no-bitwise */
function bitCount(byte: number) {
  let n = byte;
  n -= (n >> 1) & 0x55555555;
  n = (n & 0x33333333) + ((n >> 2) & 0x33333333);
  return (((n + (n >> 4)) & 0xf0f0f0f) * 0x1010101) >> 24;
}

/* eslint-enable no-bitwise */

export class MultiKey extends Serializable {
  /**
   * Authentication scheme
   */
  public readonly scheme = AuthenticationKeyScheme.MultiKey;

  /**
   * List of any public keys
   */
  public readonly publicKeys: AnyPublicKey[];

  /**
   * The minimum number of valid signatures required, for the number of public keys specified
   */
  public readonly signaturesRequired: number;

  // region Constructors

  constructor(args: { publicKeys: PublicKeyInput[]; signaturesRequired: number }) {
    super();
    const { publicKeys, signaturesRequired } = args;

    // Validate number of public keys is greater than signature required
    if (signaturesRequired < 1) {
      throw new Error("The number of required signatures needs to be greater then 0");
    }

    // Validate number of public keys is greater than signature required
    if (publicKeys.length < signaturesRequired) {
      throw new Error(
        `Provided ${publicKeys.length} public keys is smaller than the ${signaturesRequired} required signatures`,
      );
    }

    // Make sure that all keys are normalized to the SingleKey authentication scheme
    this.publicKeys = publicKeys.map((publicKey) =>
      publicKey instanceof AnyPublicKey ? publicKey : AnyPublicKey.fromPublicKey(publicKey),
    );

    this.signaturesRequired = signaturesRequired;
  }

  // endregion

  /**
   * Create a bitmap that holds the mapping from the original public keys
   * to the signatures passed in
   *
   * @param args.bits array of the index mapping to the matching public keys
   * @returns Uint8array bit map
   */
  createBitmap(args: { bits: number[] }): Uint8Array {
    const { bits } = args;
    // Bits are read from left to right. e.g. 0b10000000 represents the first bit is set in one byte.
    // The decimal value of 0b10000000 is 128.
    const firstBitInByte = 128;
    const bitmap = new Uint8Array([0, 0, 0, 0]);

    // Check if duplicates exist in bits
    const dupCheckSet = new Set();

    bits.forEach((bit: number, idx: number) => {
      if (idx + 1 > this.publicKeys.length) {
        throw new Error(`Signature index ${idx + 1} is out of public keys range, ${this.publicKeys.length}.`);
      }

      if (dupCheckSet.has(bit)) {
        throw new Error(`Duplicate bit ${bit} detected.`);
      }

      dupCheckSet.add(bit);

      const byteOffset = Math.floor(bit / 8);

      let byte = bitmap[byteOffset];

      // eslint-disable-next-line no-bitwise
      byte |= firstBitInByte >> bit % 8;

      bitmap[byteOffset] = byte;
    });

    return bitmap;
  }

  // region PublicKey

  // TODO
  // eslint-disable-next-line class-methods-use-this, @typescript-eslint/no-unused-vars
  verifySignature(args: { message: HexInput; signature: AnySignature[] }): boolean {
    throw new Error("not implemented");
  }

  authKey(): AuthenticationKey {
    return AuthenticationKey.fromSchemeAndBytes({
      scheme: this.scheme,
      input: this.bcsToBytes(),
    });
  }

  // endregion

  // region Serializable

  toUint8Array(): Uint8Array {
    return this.bcsToBytes();
  }

  /**
   * Hex string representation the multi key bytes
   *
   * @returns string
   */
  toString(): string {
    return Hex.fromHexInput(this.toUint8Array()).toString();
  }

  // endregion

  // region BcsSerializable

  serialize(serializer: Serializer): void {
    serializer.serializeVector(this.publicKeys);
    serializer.serializeU8(this.signaturesRequired);
  }

  static deserialize(deserializer: Deserializer): MultiKey {
    const keys = deserializer.deserializeVector(AnyPublicKey);
    const signaturesRequired = deserializer.deserializeU8();

    return new MultiKey({ publicKeys: keys, signaturesRequired });
  }

  // endregion
}

export class MultiKeySignature extends Serializable {
  /**
   * Number of bytes in the bitmap representing who signed the transaction (32-bits)
   */
  static BITMAP_LEN: number = 4;

  /**
   * Maximum number of Ed25519 signatures supported
   */
  static MAX_SIGNATURES_SUPPORTED = MultiKeySignature.BITMAP_LEN * 8;

  /**
   * Authentication scheme
   */
  public readonly scheme = AuthenticationKeyScheme.MultiKey;

  /**
   * The list of underlying Ed25519 signatures
   */
  public readonly signatures: AnySignature[];

  /**
   * 32-bit Bitmap representing who signed the transaction
   *
   * This is represented where each public key can be masked to determine whether the message was signed by that key.
   */
  public readonly bitmap: Uint8Array;

  /**
   * Signature for a K-of-N multi-sig transaction.
   *
   * @see {@link
   * https://aptos.dev/integration/creating-a-signed-transaction/#multisignature-transactions | Creating a Signed Transaction}
   *
   * @param args.signatures A list of signatures
   * @param args.bitmap 4 bytes, at most 32 signatures are supported. If Nth bit value is `1`, the Nth
   * signature should be provided in `signatures`. Bits are read from left to right
   */
  constructor(args: { signatures: SignatureInput[]; bitmap: Uint8Array | number[] }) {
    super();
    const { signatures, bitmap } = args;

    if (signatures.length > MultiKeySignature.MAX_SIGNATURES_SUPPORTED) {
      throw new Error(`The number of signatures cannot be greater than ${MultiKeySignature.MAX_SIGNATURES_SUPPORTED}`);
    }

    // Make sure that all signatures are normalized to the SingleKey authentication scheme
    this.signatures = signatures.map((signature) =>
      signature instanceof AnySignature ? signature : AnySignature.fromSignature(signature),
    );

    if (!(bitmap instanceof Uint8Array)) {
      this.bitmap = MultiKeySignature.createBitmap({ bits: bitmap });
    } else if (bitmap.length !== MultiKeySignature.BITMAP_LEN) {
      throw new Error(`"bitmap" length should be ${MultiKeySignature.BITMAP_LEN}`);
    } else {
      this.bitmap = bitmap;
    }

    const nSignatures = this.bitmap.reduce((acc, byte) => acc + bitCount(byte), 0);
    if (nSignatures !== this.signatures.length) {
      throw new Error(`Expecting ${nSignatures} signatures from the bitmap, but got ${this.signatures.length}`);
    }
  }

  /**
   * Helper method to create a bitmap out of the specified bit positions
   * @param args.bits The bitmap positions that should be set. A position starts at index 0.
   * Valid position should range between 0 and 31.
   * @example
   * Here's an example of valid `bits`
   * ```
   * [0, 2, 31]
   * ```
   * `[0, 2, 31]` means the 1st, 3rd and 32nd bits should be set in the bitmap.
   * The result bitmap should be 0b1010000000000000000000000000001
   *
   * @returns bitmap that is 32bit long
   */
  static createBitmap(args: { bits: number[] }): Uint8Array {
    const { bits } = args;
    // Bits are read from left to right. e.g. 0b10000000 represents the first bit is set in one byte.
    // The decimal value of 0b10000000 is 128.
    const firstBitInByte = 128;
    const bitmap = new Uint8Array([0, 0, 0, 0]);

    // Check if duplicates exist in bits
    const dupCheckSet = new Set();

    bits.forEach((bit: number) => {
      if (bit >= MultiKeySignature.MAX_SIGNATURES_SUPPORTED) {
        throw new Error(`Cannot have a signature larger than ${MultiKeySignature.MAX_SIGNATURES_SUPPORTED - 1}.`);
      }

      if (dupCheckSet.has(bit)) {
        throw new Error("Duplicate bits detected.");
      }

      dupCheckSet.add(bit);

      const byteOffset = Math.floor(bit / 8);

      let byte = bitmap[byteOffset];

      // eslint-disable-next-line no-bitwise
      byte |= firstBitInByte >> bit % 8;

      bitmap[byteOffset] = byte;
    });

    return bitmap;
  }

  // region BcsSerializable

  serialize(serializer: Serializer): void {
    serializer.serializeBytes(this.bitmap);
    // Note: no need to serialize the number of signatures, as it can be derived from the bitmap
    for (const signature of this.signatures) {
      signature.serialize(serializer);
    }
  }

  static deserialize(deserializer: Deserializer): MultiKeySignature {
    const bitmap = deserializer.deserializeBytes();
    const nSignatures = bitmap.reduce((acc, byte) => acc + bitCount(byte), 0);
    const signatures: AnySignature[] = [];
    for (let i = 0; i < nSignatures; i += 1) {
      const signature = AnySignature.deserialize(deserializer);
      signatures.push(signature);
    }
    return new MultiKeySignature({ signatures, bitmap });
  }

  // endregion
}
