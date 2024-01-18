import { Deserializer, Serializable, Serializer } from "../../bcs";
import {
  AnyPublicKeyVariant,
  AnySignatureVariant,
  HexInput,
  SigningScheme as AuthenticationKeyScheme,
  SigningSchemeInput,
} from "../../types";
import { AuthenticationKey } from "../authenticationKey";
import { Ed25519PublicKey, Ed25519Signature } from "./ed25519";
import { Secp256k1PublicKey, Secp256k1Signature } from "./secp256k1";

type PublicKeyInput = Ed25519PublicKey | Secp256k1PublicKey;
type SignatureInput = Ed25519Signature | Secp256k1Signature;

/**
 * Represents any public key supported by Aptos.
 *
 * Since [AIP-55](https://github.com/aptos-foundation/AIPs/pull/263) Aptos supports
 * `Legacy` and `Unified` authentication keys.
 *
 * Any unified authentication key is represented in the SDK as `AnyPublicKey`.
 */
export class AnyPublicKey extends Serializable {
  /**
   * Authentication scheme
   */
  public readonly scheme = AuthenticationKeyScheme.SingleKey;

  /**
   * Reference to the inner public key
   */
  public readonly publicKey: PublicKeyInput;

  /**
   * Index of the underlying enum variant
   */
  public readonly variant: AnyPublicKeyVariant;

  // region Constructors

  protected constructor(publicKey: PublicKeyInput, variant: AnyPublicKeyVariant) {
    super();
    this.publicKey = publicKey;
    this.variant = variant;
  }

  static fromPublicKey(publicKey: PublicKeyInput) {
    let variantIndex: AnyPublicKeyVariant;
    if (publicKey instanceof Ed25519PublicKey) {
      variantIndex = AnyPublicKeyVariant.Ed25519;
    } else if (publicKey instanceof Secp256k1PublicKey) {
      variantIndex = AnyPublicKeyVariant.Secp256k1;
    } else {
      throw new Error("Unsupported public key type");
    }
    return new AnyPublicKey(publicKey, variantIndex);
  }

  // endregion

  // region PublicKey

  /**
   * Verifies a signed data with a public key
   *
   * @param args.message message
   * @param args.signature The signature
   * @returns true if the signature is valid
   */
  verifySignature(args: { message: HexInput; signature: AnySignature }): boolean {
    const { message, signature } = args;
    if (this.publicKey instanceof Ed25519PublicKey && signature.signature instanceof Ed25519Signature) {
      return this.publicKey.verifySignature({ message, signature: signature.signature });
    }
    if (this.publicKey instanceof Secp256k1PublicKey && signature.signature instanceof Secp256k1Signature) {
      return this.publicKey.verifySignature({ message, signature: signature.signature });
    }
    return false;
  }

  authKey(): AuthenticationKey {
    return AuthenticationKey.fromSchemeAndBytes({
      scheme: this.scheme,
      input: this.bcsToBytes(),
    });
  }

  // endregion

  // region BcsSerializable

  serialize(serializer: Serializer): void {
    serializer.serializeU32AsUleb128(this.variant);
    this.publicKey.serialize(serializer);
  }

  static deserialize(deserializer: Deserializer): AnyPublicKey {
    const variantIndex = deserializer.deserializeUleb128AsU32();
    let publicKey: PublicKeyInput;
    switch (variantIndex) {
      case AnyPublicKeyVariant.Ed25519:
        publicKey = Ed25519PublicKey.deserialize(deserializer);
        break;
      case AnyPublicKeyVariant.Secp256k1:
        publicKey = Secp256k1PublicKey.deserialize(deserializer);
        break;
      default:
        throw new Error(`Unknown variant index for AnyPublicKey: ${variantIndex}`);
    }
    return new AnyPublicKey(publicKey, variantIndex);
  }

  // endregion

  isEd25519(): this is Ed25519PublicKey {
    return this.variant === AnyPublicKeyVariant.Ed25519;
  }

  isSecp256k1(): this is Secp256k1PublicKey {
    return this.variant === AnyPublicKeyVariant.Secp256k1;
  }

  toString() {
    return this.publicKey.toString();
  }
}

export class AnySignature extends Serializable {
  /**
   * Authentication scheme
   */
  public readonly scheme = AuthenticationKeyScheme.SingleKey;

  public readonly signature: SignatureInput;

  /**
   * Index of the underlying enum variant
   */
  private readonly variant: AnySignatureVariant;

  // region Constructors

  constructor(signature: SignatureInput, variant: AnySignatureVariant) {
    super();
    this.signature = signature;
    this.variant = variant;
  }

  static fromSignature(signature: SignatureInput) {
    let variantIndex: AnySignatureVariant;
    if (signature instanceof Ed25519Signature) {
      variantIndex = AnySignatureVariant.Ed25519;
    } else if (signature instanceof Secp256k1Signature) {
      variantIndex = AnySignatureVariant.Secp256k1;
    } else {
      throw new Error("Unsupported signature type");
    }
    return new AnySignature(signature, variantIndex);
  }

  // endregion

  // region BcsSerializable

  serialize(serializer: Serializer): void {
    if (this.signature instanceof Ed25519Signature) {
      serializer.serializeU32AsUleb128(SigningSchemeInput.Ed25519);
      this.signature.serialize(serializer);
    } else if (this.signature instanceof Secp256k1Signature) {
      serializer.serializeU32AsUleb128(SigningSchemeInput.Secp256k1Ecdsa);
      this.signature.serialize(serializer);
    } else {
      throw new Error("Unknown signature type");
    }
  }

  static deserialize(deserializer: Deserializer): AnySignature {
    const variantIndex = deserializer.deserializeUleb128AsU32();
    let signature: SignatureInput;
    switch (variantIndex) {
      case AnySignatureVariant.Ed25519:
        signature = Ed25519Signature.deserialize(deserializer);
        break;
      case AnySignatureVariant.Secp256k1:
        signature = Secp256k1Signature.deserialize(deserializer);
        break;
      default:
        throw new Error(`Unknown variant index for AnySignature: ${variantIndex}`);
    }
    return new AnySignature(signature, variantIndex);
  }

  // endregion

  toString() {
    return this.signature.toString();
  }
}
