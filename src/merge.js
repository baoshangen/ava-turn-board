// Three-way merge: independent edits combine; edits to the same value need review.
function mergeBoard(base, local, remote) {
  const equal = (a,b) => JSON.stringify(a) === JSON.stringify(b);
  if (equal(local, base)) return remote;
  if (equal(remote, base) || equal(local, remote)) return local;
  const object = x => x && typeof x === 'object' && !Array.isArray(x);
  if (object(base) && object(local) && object(remote)) {
    const result = {};
    for (const key of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])) {
      const value = mergeBoard(base[key], local[key], remote[key]);
      if (value !== undefined) result[key] = value;
    }
    return result;
  }
  throw new Error('Two devices edited the same item. Your unsaved changes are still here. Tap Retry to load the latest board.');
}
