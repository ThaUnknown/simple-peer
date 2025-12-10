import Peer from '../index.js'
import str from 'string-to-stream'
import { test, expect } from 'vitest'

test('duplex stream: send data one-way', { timeout: 20000 }, function () {
  return new Promise<void>((resolve) => {
    const peer1 = new Peer({ initiator: true })
    const peer2 = new Peer()
    peer1.on('signal', function (data) { peer2.signal(data) })
    peer2.on('signal', function (data) { peer1.signal(data) })
    peer1.on('connect', tryTest)
    peer2.on('connect', tryTest)

    function tryTest () {
      if (!peer1.connected || !peer2.connected) return

      peer1.on('data', function () {
        throw new Error('peer1 should not get data')
      })
      peer1.on('finish', function () {
        expect((peer1 as unknown as { _writableState: { ended: boolean } })._writableState.ended).toBe(true)
      })
      peer1.on('end', function () {
        expect((peer1 as unknown as { _readableState: { ended: boolean } })._readableState.ended).toBe(true)
      })

      peer2.on('data', function (chunk) {
        expect(Buffer.from(chunk as Uint8Array).toString()).toBe('abc')
      })
      peer2.on('finish', function () {
        expect((peer2 as unknown as { _writableState: { ended: boolean } })._writableState.ended).toBe(true)
      })
      peer2.on('end', function () {
        expect((peer2 as unknown as { _readableState: { ended: boolean } })._readableState.ended).toBe(true)
        resolve()
      })

      str('abc').pipe(peer1 as unknown as NodeJS.WritableStream)
    }
  })
})
