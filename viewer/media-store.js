import { validateRecord } from "./media-core.js";

export async function openMediaStore(trail) {
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open("trail-analytics-media", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("items", { keyPath: "key" }).createIndex("trail", "record.trail");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Close other trail tabs and retry media storage."));
  });
  database.onversionchange = () => database.close();
  const transaction = (mode, operation) => new Promise((resolve, reject) => {
    const transaction = database.transaction("items", mode);
    const request = operation(transaction.objectStore("items"));
    transaction.oncomplete = () => resolve(request?.result);
    transaction.onabort = transaction.onerror = () => reject(transaction.error || new Error("Media storage failed. Back up your files and free browser space."));
  });
  return {
    list: () => transaction("readonly", (store) => store.index("trail").getAll(trail)),
    put: (record, blob) => {
      validateRecord(record);
      if (record.trail !== trail || !(blob instanceof Blob) || blob.size !== record.size) throw new Error("Invalid media storage request.");
      return transaction("readwrite", (store) => store.put({ key: `${trail}:${record.id}`, record, blob }));
    },
    remove: (id) => transaction("readwrite", (store) => store.delete(`${trail}:${id}`)),
  };
}
