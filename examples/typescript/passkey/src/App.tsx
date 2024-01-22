import { useState } from "react";
import "./App.css";
import { AccountAddress, Aptos, AptosConfig, Network, Secp256r1PublicKey } from "@aptos-labs/ts-sdk";

const ALICE_INITIAL_BALANCE = 100_000_000;
const COIN_STORE = "0x1::coin::CoinStore<0x1::aptos_coin::AptosCoin>";
const config = new AptosConfig({ network: Network.DEVNET });
const aptos = new Aptos(config);

function App() {
  const [credentialId, setCredentialId] = useState<string | null>(window.localStorage.getItem("credentialId"));

  const [publicKey, setPublicKey] = useState<string | null>(window.localStorage.getItem("publicKey"));

  const [recipientAddress, setRecipientAddress] = useState<string | null>(null);
  const [sendAmount, setSendAmount] = useState<number>(0);
  const [passkeyAddr, setPasskeyAddr] = useState<string | null>(null);

  /**
   * Prints the balance of an account
   * @param aptos
   * @param name
   * @param address
   * @returns {Promise<*>}
   *
   */
  const balance = async (aptos: Aptos, name: string, address: AccountAddress) => {
    type Coin = { coin: { value: string } };
    const resource = await aptos.getAccountResource<Coin>({
      accountAddress: address,
      resourceType: COIN_STORE,
    });
    const amount = Number(resource.coin.value);

    console.log(`${name}'s balance is: ${amount}`);
    return amount;
  };

  // Create the passkey via credential registration ceremony
  const createPasskey = async () => {
    const options = await aptos.generateRegistrationOptions({
      rpName: window.location.origin,
      rpID: window.location.hostname,
      userName: "Andrew",
      userID: "andrew.apt",
      authenticatorAttachment: "platform",
    });

    const cred = await aptos.registerCredential(options);
    const pubKey = aptos.parsePublicKey(cred);
    const addr = await aptos.getPasskeyAccountAddress({ publicKey: pubKey.toString() });

    console.log(addr.toString());

    setCredentialId(cred.rawId);
    setPublicKey(aptos.parsePublicKey(cred).toString());
    setPasskeyAddr(addr.toString());
    console.log(cred);
    window.localStorage.setItem("credentialId", cred.rawId);
    window.localStorage.setItem("publicKey", aptos.parsePublicKey(cred).toString());
  };

  const fundAccount = async () => {
    if (!publicKey) {
      alert("No registered publicKey");
      return;
    }

    const addr = await aptos.getPasskeyAccountAddress({ publicKey });

    const pendingTxn = await aptos.faucet.fundAccount({
      accountAddress: addr.toUint8Array(),
      amount: ALICE_INITIAL_BALANCE,
    });

    const confirmedTxn = await aptos.waitForTransaction({ transactionHash: pendingTxn.hash });
    alert("Faucet 1 APT deposited, txn hash: " + confirmedTxn.hash);

    console.log("\n=== Balances ===\n");
    await balance(aptos, "Passkey Account", new AccountAddress(addr.toUint8Array()));
  };

  const checkBalance = async () => {
    if (!publicKey) {
      alert("No registered publicKey");
      return;
    }

    const addr = await aptos.getPasskeyAccountAddress({ publicKey });

    console.log("\n=== Balances ===\n");
    const bal = await balance(aptos, "Passkey Account", new AccountAddress(addr.toUint8Array()));

    window.alert(bal / 1e8 + " APT");
  };

  /**
   * Use the passkey credential registered to the user to sign a coin transfer
   */
  const signWithPasskey = async () => {
    if (!credentialId) {
      alert("No registered credential");
      return;
    }

    if (!publicKey) {
      alert("No registered publicKey");
      return;
    }

    const addr = await aptos.getPasskeyAccountAddress({ publicKey });
    const recipient = AccountAddress.fromString(recipientAddress || "0x1");

    const txn = await aptos.transferCoinTransaction({
      sender: addr,
      recipient: recipient,
      amount: sendAmount * 1e8,
    });

    console.log("\n=== Transfer transaction ===\n");
    // const committedTxn =
    const pendingTxn = await aptos.signAndSubmitWithPasskey({
      credentialId: credentialId,
      transaction: txn,
      publicKey: new Secp256r1PublicKey(publicKey),
    });

    const committedTxn = await aptos.waitForTransaction({ transactionHash: pendingTxn.hash });
    console.log(committedTxn);

    // This doesn't work until the indexer works for passkeys
    // await aptos.waitForTransaction({ transactionHash: committedTxn.hash });
    // console.log(`Committed transaction: ${committedTxn.hash}`);
  };

  const getAddress = async () => {
    if (!credentialId) {
      alert("No registered credential");
      return;
    }

    if (!publicKey) {
      alert("No registered publicKey");
      return;
    }

    const addr = await aptos.getPasskeyAccountAddress({ publicKey: publicKey });
    setPasskeyAddr(addr.toString());

    alert(addr);
  };

  return (
    <>
      <h1>Passkeys Demo</h1>
      {passkeyAddr ? <p className="text-wrap">{"Your address: " + passkeyAddr}</p> : null}
      {passkeyAddr ? (
        <a
          href={`https://explorer.aptoslabs.com/account/${passkeyAddr}/transactions?network=devnet`}
          target="_blank"
          className="text-wrap"
        >
          Explorer link
        </a>
      ) : null}
      <div className="card">
        <div className="comfy-row">
          <button onClick={createPasskey}>Create credential</button>
          <button onClick={fundAccount}>Fund Account</button>
          <button onClick={checkBalance}>Check Balance</button>
          <button onClick={signWithPasskey}>Sign with credential</button>
          <button onClick={getAddress}>Get address</button>
        </div>
        <h3>Recipient address</h3>
        <input value={recipientAddress || ""} onChange={(e) => setRecipientAddress(e.currentTarget.value)} />
        <h3>Send amount (APT)</h3>
        <input value={sendAmount} onChange={(e) => setSendAmount(Number(e.currentTarget.value))} />
        <p>rpId: {window.location.hostname}</p>
      </div>
    </>
  );
}

export default App;
