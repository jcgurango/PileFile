import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

/** Attachment bytes on disk: <root>/<userId>/<attachmentId>. Ids are UUIDs, so paths are safe. */
export class AttachmentStore {
  private readonly root: string

  constructor(root: string) {
    this.root = root
  }

  private pathFor(userId: string, id: string): string {
    if (!/^[0-9a-f-]{36}$/i.test(id) || !/^[0-9a-f-]{36}$/i.test(userId)) throw new Error('bad id')
    return join(this.root, userId, id)
  }

  async save(userId: string, id: string, body: ReadableStream<Uint8Array>): Promise<number> {
    const target = this.pathFor(userId, id)
    await mkdir(join(this.root, userId), { recursive: true })
    const tmp = `${target}.part`
    await pipeline(Readable.fromWeb(body as import('node:stream/web').ReadableStream<Uint8Array>), createWriteStream(tmp))
    await rename(tmp, target)
    return (await stat(target)).size
  }

  async size(userId: string, id: string): Promise<number | null> {
    try {
      return (await stat(this.pathFor(userId, id))).size
    } catch {
      return null
    }
  }

  open(userId: string, id: string): ReadableStream<Uint8Array> {
    return Readable.toWeb(createReadStream(this.pathFor(userId, id))) as ReadableStream<Uint8Array>
  }

  async remove(userId: string, id: string): Promise<void> {
    await rm(this.pathFor(userId, id), { force: true })
  }
}
