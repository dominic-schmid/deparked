/** A release version: `x.y.z` with an optional pre-release (`1.2.0-rc.1`), as in a tag `v1.2.0-rc.1`. */
export const RELEASE_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function compareIdentifiers(a: string, b: string): number {
  const numeric = /^\d+$/;
  if (numeric.test(a) && numeric.test(b)) return Math.sign(Number(a) - Number(b));
  if (numeric.test(a)) return -1;
  if (numeric.test(b)) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Semantic version precedence: negative when `a` is older than `b`, 0 when equal, positive when newer. A
 * pre-release is older than its release (`1.2.0-rc.1` < `1.2.0`).
 */
export function compareVersions(a: string, b: string): number {
  const [coreA = "", ...restA] = a.split("-");
  const [coreB = "", ...restB] = b.split("-");
  const partsA = coreA.split(".").map(Number);
  const partsB = coreB.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = (partsA[index] ?? 0) - (partsB[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  const preA = restA.join("-");
  const preB = restB.join("-");
  if (preA === preB) return 0;
  if (preA === "") return 1;
  if (preB === "") return -1;
  const idsA = preA.split(".");
  const idsB = preB.split(".");
  for (let index = 0; index < Math.min(idsA.length, idsB.length); index += 1) {
    const order = compareIdentifiers(idsA[index] ?? "", idsB[index] ?? "");
    if (order !== 0) return order;
  }
  return Math.sign(idsA.length - idsB.length);
}
