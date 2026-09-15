// In-memory audio store — holds synthesized TTS bytes for the process lifetime.
// Phase 1 MVP: single-node, bounded. Swap for object storage (S3) in a later phase.
//
// Audio ids are random UUIDs: the audio endpoint is unauthenticated (the browser
// <audio> element cannot send an Authorization header), so the id itself is the
// capability — it must be unguessable.
import { randomUUID } from 'node:crypto';
export class AudioStore {
    store = new Map();
    put(bytes, mimeType) {
        const id = randomUUID();
        const entry = { id, bytes, mimeType, createdAt: new Date().toISOString() };
        this.store.set(id, entry);
        return entry;
    }
    get(id) {
        return this.store.get(id) ?? null;
    }
    clear() {
        this.store.clear();
    }
}
//# sourceMappingURL=audio-store.js.map