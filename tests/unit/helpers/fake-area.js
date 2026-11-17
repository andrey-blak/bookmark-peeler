// A storage area in memory, with the parts of the storage API that the add-on uses, and a log of its calls.
export function fakeArea(initial = {}) {
  const data = { ...structuredClone(initial) };
  const calls = [];

  return {
    data,
    calls,

    async get(keys) {
      calls.push(["get", keys]);
      if (keys === null || keys === undefined) return structuredClone(data);

      const wanted = Array.isArray(keys) ? keys : [keys];
      return structuredClone(Object.fromEntries(wanted.filter(key => key in data).map(key => [key, data[key]])));
    },

    async set(items) {
      calls.push(["set", Object.keys(items)]);
      Object.assign(data, structuredClone(items));
    },

    async remove(keys) {
      calls.push(["remove", [...keys]]);
      for (const key of keys) delete data[key];
    },
  };
}
