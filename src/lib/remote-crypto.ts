function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=")
  const binary = atob(padded)
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function encodeBase64Url(value: Uint8Array): string {
  let binary = ""
  for (const byte of value) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
}

async function encryptionKey(value: string): Promise<CryptoKey> {
  const raw = decodeBase64Url(value)
  if (raw.length !== 32) throw new Error("Orbit Relay 加密密钥无效")
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"])
}

export async function encryptRemoteFrame(value: string, key: string): Promise<string> {
  const nonce = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)))
  const plaintext = new TextEncoder().encode(value)
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, await encryptionKey(key), plaintext))
  const frame = new Uint8Array(new ArrayBuffer(nonce.length + ciphertext.length))
  frame.set(nonce)
  frame.set(ciphertext, nonce.length)
  return encodeBase64Url(frame)
}

export async function decryptRemoteFrame(value: string, key: string): Promise<string> {
  const frame = decodeBase64Url(value)
  if (frame.length < 29) throw new Error("Orbit Relay 加密帧无效")
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: frame.slice(0, 12) }, await encryptionKey(key), frame.slice(12))
  return new TextDecoder().decode(plaintext)
}
