const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** A ULID: 10 characters of time (so ids sort by creation) and 16 random ones. */
export function ulid(now: number): string {
  let time = "";
  let rest = now;
  for (let i = 0; i < 10; i++) {
    time = ALPHABET.charAt(rest % 32) + time;
    rest = Math.floor(rest / 32);
  }
  let random = "";
  for (const byte of crypto.getRandomValues(new Uint8Array(16))) {
    random += ALPHABET.charAt(byte % 32);
  }
  return time + random;
}
